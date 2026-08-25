import { queryDatabase } from '../../infrastructure/database/postgres.js';
import {
  FEATURE_FLAG_STATUS,
  FEATURE_FLAG_TARGET,
  featureFlagBucketSubject,
  featureFlagRolloutDecision,
  normalizeFeatureFlagEnvironment,
  normalizeFeatureFlagExpectedVersion,
  normalizeFeatureFlagKey,
  normalizeFeatureFlagReason,
  normalizeFeatureFlagRolloutBasisPoints,
  normalizeFeatureFlagRuleId,
  normalizeFeatureFlagTarget,
  normalizeFeatureFlagTenantId,
  stableFeatureFlagBucket,
} from './feature-flag-domain.js';

const flagColumns = `
  id,
  key,
  name,
  description,
  default_enabled,
  status,
  hash_version,
  created_at,
  updated_at,
  version
`;

const policyColumns = `
  id,
  flag_id,
  environment,
  enabled,
  rollout_basis_points,
  status,
  created_at,
  updated_at,
  version
`;

const ruleColumns = `
  id,
  tenant_id,
  flag_id,
  environment,
  target_type,
  company_id,
  branch_id,
  user_id,
  plan_key,
  enabled,
  rollout_basis_points,
  status,
  created_at,
  updated_at,
  version
`;

export class PostgresFeatureFlagRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Feature flag repository query dependency must be a function');
    }
    this.query = query;
  }

  async evaluate(tenantId, key, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw repositoryError('MVT_FEATURE_FLAG_INPUT_INVALID', 'Feature flag evaluation input is invalid');
    }

    const tenant = normalizeFeatureFlagTenantId(tenantId);
    const flagKey = normalizeFeatureFlagKey(key);
    const environment = normalizeFeatureFlagEnvironment(input.environment);
    const context = normalizeEvaluationContext(input);
    await this.#assertEvaluationContext(tenant, context);

    const flag = await this.findActiveFlagByKey(flagKey);
    if (!flag) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_NOT_OPERATIONAL',
        'Active feature flag was not found',
      );
    }

    const bucketSubject = featureFlagBucketSubject({ tenantId: tenant, userId: context.userId });
    const bucket = stableFeatureFlagBucket({
      flagKey: flag.key,
      subject: bucketSubject,
      hashVersion: flag.hashVersion,
    });
    const environmentPolicy = await this.#findActiveEnvironmentPolicy(flag.id, environment);

    if (environmentPolicy && environmentPolicy.enabled === false) {
      return freezeDecision({
        key: flag.key,
        enabled: false,
        source: 'ENVIRONMENT_POLICY',
        ruleId: null,
        ruleVersion: null,
        rolloutBasisPoints: environmentPolicy.rolloutBasisPoints,
        bucket,
        hashVersion: flag.hashVersion,
      });
    }

    const candidates = buildEvaluationCandidates(context);
    for (const target of candidates) {
      const rule = await this.#findActiveRule(tenant, flag.id, environment, target);
      if (rule) {
        return freezeDecision({
          key: flag.key,
          enabled: featureFlagRolloutDecision({
            enabled: rule.enabled,
            rolloutBasisPoints: rule.rolloutBasisPoints,
            bucket,
          }),
          source: rule.targetType,
          ruleId: rule.id,
          ruleVersion: rule.version,
          rolloutBasisPoints: rule.rolloutBasisPoints,
          bucket,
          hashVersion: flag.hashVersion,
        });
      }
    }

    if (environmentPolicy) {
      return freezeDecision({
        key: flag.key,
        enabled: featureFlagRolloutDecision({
          enabled: environmentPolicy.enabled,
          rolloutBasisPoints: environmentPolicy.rolloutBasisPoints,
          bucket,
        }),
        source: 'ENVIRONMENT_POLICY',
        ruleId: null,
        ruleVersion: null,
        rolloutBasisPoints: environmentPolicy.rolloutBasisPoints,
        bucket,
        hashVersion: flag.hashVersion,
      });
    }

    return freezeDecision({
      key: flag.key,
      enabled: featureFlagRolloutDecision({
        enabled: flag.defaultEnabled,
        rolloutBasisPoints: 10000,
        bucket,
      }),
      source: 'FLAG_DEFAULT',
      ruleId: null,
      ruleVersion: null,
      rolloutBasisPoints: 10000,
      bucket,
      hashVersion: flag.hashVersion,
    });
  }

  async findActiveFlagByKey(key) {
    const flagKey = normalizeFeatureFlagKey(key);
    const result = await this.query(
      `SELECT ${flagColumns}
         FROM feature_flags.flags
        WHERE key = $1
          AND status = 'ACTIVE'`,
      [flagKey],
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : null;
  }

  async putRule(tenantId, key, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw repositoryError('MVT_FEATURE_FLAG_INPUT_INVALID', 'Feature flag rule input is invalid');
    }

    const tenant = normalizeFeatureFlagTenantId(tenantId);
    const flagKey = normalizeFeatureFlagKey(key);
    const environment = normalizeOptionalEnvironment(input.environment);
    const target = normalizeFeatureFlagTarget(input.target);
    const enabled = normalizeEnabled(input.enabled);
    const rolloutBasisPoints = normalizeFeatureFlagRolloutBasisPoints(input.rolloutBasisPoints);
    const reason = normalizeFeatureFlagReason(input.reason);

    await this.#assertTarget(tenant, target);
    const flag = await this.findActiveFlagByKey(flagKey);
    if (!flag) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_NOT_OPERATIONAL',
        'Inactive or missing feature flag cannot accept tenant rules',
      );
    }

    const current = await this.#findActiveRuleByTarget(tenant, flag.id, environment, target);
    if (input.expectedVersion === null || input.expectedVersion === undefined) {
      if (current) {
        throw repositoryError(
          'MVT_FEATURE_FLAG_VERSION_REQUIRED',
          'expectedVersion is required to update an existing active rule',
        );
      }
      return this.#createRule({
        tenant,
        flag,
        environment,
        target,
        enabled,
        rolloutBasisPoints,
        reason,
      });
    }

    const expectedVersion = normalizeFeatureFlagExpectedVersion(input.expectedVersion);
    if (!current) {
      throw repositoryError('MVT_FEATURE_FLAG_RULE_NOT_FOUND', 'Active feature flag rule was not found');
    }
    if (current.version !== expectedVersion) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_VERSION_CONFLICT',
        'Feature flag rule version does not match expectedVersion',
      );
    }

    return this.#updateRule({
      tenant,
      current,
      enabled,
      rolloutBasisPoints,
      expectedVersion,
      reason,
    });
  }

  async transitionRuleStatus(tenantId, ruleId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw repositoryError('MVT_FEATURE_FLAG_INPUT_INVALID', 'Feature flag status input is invalid');
    }

    const tenant = normalizeFeatureFlagTenantId(tenantId);
    const id = normalizeFeatureFlagRuleId(ruleId);
    const expectedVersion = normalizeFeatureFlagExpectedVersion(input.expectedVersion);
    const reason = normalizeFeatureFlagReason(input.reason);
    const toStatus = String(input.toStatus ?? '').trim().toUpperCase();
    if (!Object.values(FEATURE_FLAG_STATUS).includes(toStatus)) {
      throw repositoryError('MVT_FEATURE_FLAG_STATUS_INVALID', 'Feature flag rule status is invalid');
    }

    const current = await this.#findRuleWithFlag(tenant, id);
    if (!current) {
      throw repositoryError('MVT_FEATURE_FLAG_RULE_NOT_FOUND', 'Feature flag rule was not found');
    }
    if (current.rule.version !== expectedVersion) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_VERSION_CONFLICT',
        'Feature flag rule version does not match expectedVersion',
      );
    }
    if (current.rule.status === toStatus) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_STATUS_CONFLICT',
        'Feature flag rule is already in the requested status',
      );
    }
    if (toStatus === FEATURE_FLAG_STATUS.ACTIVE) {
      if (current.flag.status !== FEATURE_FLAG_STATUS.ACTIVE) {
        throw repositoryError(
          'MVT_FEATURE_FLAG_NOT_OPERATIONAL',
          'Inactive feature flag cannot activate a tenant rule',
        );
      }
      await this.#assertTarget(tenant, targetFromRule(current.rule));
    }

    let result;
    try {
      result = await this.query(
        `UPDATE feature_flags.rules
            SET status = $4,
                updated_at = now(),
                version = version + 1
          WHERE tenant_id = $1
            AND id = $2
            AND version = $3
        RETURNING ${ruleColumns}`,
        [tenant, id, expectedVersion, toStatus],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw repositoryError(
          'MVT_FEATURE_FLAG_ACTIVE_CONFLICT',
          'Another active feature flag rule already exists for this target',
        );
      }
      throw error;
    }

    if (!result.rows[0]) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_VERSION_CONFLICT',
        'Feature flag rule changed concurrently',
      );
    }

    const rule = mapRule(result.rows[0]);
    const changeType = toStatus === FEATURE_FLAG_STATUS.ACTIVE ? 'ACTIVATE' : 'INACTIVATE';
    await this.#appendRuleVersion({ tenant, rule, changeType, reason });
    return Object.freeze({ rule, flag: current.flag, changeType });
  }

  async restoreRuleVersion(tenantId, ruleId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw repositoryError('MVT_FEATURE_FLAG_INPUT_INVALID', 'Feature flag restore input is invalid');
    }

    const tenant = normalizeFeatureFlagTenantId(tenantId);
    const id = normalizeFeatureFlagRuleId(ruleId);
    const expectedVersion = normalizeFeatureFlagExpectedVersion(input.expectedVersion);
    const restoreVersion = normalizeFeatureFlagExpectedVersion(input.restoreVersion);
    const reason = normalizeFeatureFlagReason(input.reason);
    const current = await this.#findRuleWithFlag(tenant, id);
    if (!current) {
      throw repositoryError('MVT_FEATURE_FLAG_RULE_NOT_FOUND', 'Feature flag rule was not found');
    }
    if (current.rule.version !== expectedVersion) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_VERSION_CONFLICT',
        'Feature flag rule version does not match expectedVersion',
      );
    }

    const historical = await this.#findRuleVersion(tenant, id, restoreVersion);
    if (!historical) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_HISTORY_NOT_FOUND',
        'Requested feature flag rule history version was not found',
      );
    }
    if (historical.status === FEATURE_FLAG_STATUS.ACTIVE) {
      if (current.flag.status !== FEATURE_FLAG_STATUS.ACTIVE) {
        throw repositoryError(
          'MVT_FEATURE_FLAG_NOT_OPERATIONAL',
          'Inactive feature flag cannot restore an active tenant rule',
        );
      }
      await this.#assertTarget(tenant, targetFromRule(current.rule));
    }

    let result;
    try {
      result = await this.query(
        `UPDATE feature_flags.rules
            SET enabled = $4,
                rollout_basis_points = $5,
                status = $6,
                updated_at = now(),
                version = version + 1
          WHERE tenant_id = $1
            AND id = $2
            AND version = $3
        RETURNING ${ruleColumns}`,
        [
          tenant,
          id,
          expectedVersion,
          historical.enabled,
          historical.rolloutBasisPoints,
          historical.status,
        ],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw repositoryError(
          'MVT_FEATURE_FLAG_ACTIVE_CONFLICT',
          'Restoring this rule would conflict with another active target rule',
        );
      }
      throw error;
    }

    if (!result.rows[0]) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_VERSION_CONFLICT',
        'Feature flag rule changed concurrently',
      );
    }

    const rule = mapRule(result.rows[0]);
    await this.#appendRuleVersion({ tenant, rule, changeType: 'RESTORE', reason });
    return Object.freeze({ rule, flag: current.flag, changeType: 'RESTORE' });
  }

  async #createRule({ tenant, flag, environment, target, enabled, rolloutBasisPoints, reason }) {
    let result;
    try {
      result = await this.query(
        `INSERT INTO feature_flags.rules (
           tenant_id, flag_id, environment, target_type, company_id, branch_id,
           user_id, plan_key, enabled, rollout_basis_points, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE')
         RETURNING ${ruleColumns}`,
        [
          tenant,
          flag.id,
          environment,
          target.type,
          target.companyId,
          target.branchId,
          target.userId,
          target.planKey,
          enabled,
          rolloutBasisPoints,
        ],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw repositoryError(
          'MVT_FEATURE_FLAG_ACTIVE_CONFLICT',
          'An active feature flag rule already exists for this target',
        );
      }
      if (error?.code === '23503') {
        throw repositoryError(
          'MVT_FEATURE_FLAG_TARGET_NOT_FOUND',
          'Feature flag target does not belong to the requested Tenant',
        );
      }
      throw error;
    }

    const rule = mapRule(result.rows[0]);
    await this.#appendRuleVersion({ tenant, rule, changeType: 'CREATE', reason });
    return Object.freeze({ rule, flag, changeType: 'CREATE' });
  }

  async #updateRule({ tenant, current, enabled, rolloutBasisPoints, expectedVersion, reason }) {
    const result = await this.query(
      `UPDATE feature_flags.rules
          SET enabled = $4,
              rollout_basis_points = $5,
              updated_at = now(),
              version = version + 1
        WHERE tenant_id = $1
          AND id = $2
          AND version = $3
          AND status = 'ACTIVE'
      RETURNING ${ruleColumns}`,
      [tenant, current.id, expectedVersion, enabled, rolloutBasisPoints],
    );
    if (!result.rows[0]) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_VERSION_CONFLICT',
        'Feature flag rule changed concurrently',
      );
    }
    const rule = mapRule(result.rows[0]);
    await this.#appendRuleVersion({ tenant, rule, changeType: 'UPDATE', reason });
    return Object.freeze({ rule, changeType: 'UPDATE' });
  }

  async #appendRuleVersion({ tenant, rule, changeType, reason }) {
    await this.query(
      `INSERT INTO feature_flags.rule_versions (
         tenant_id, rule_id, rule_version, enabled, rollout_basis_points,
         status, change_type, reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        tenant,
        rule.id,
        rule.version,
        rule.enabled,
        rule.rolloutBasisPoints,
        rule.status,
        changeType,
        reason,
      ],
    );
  }

  async #findActiveEnvironmentPolicy(flagId, environment) {
    const result = await this.query(
      `SELECT ${policyColumns}
         FROM feature_flags.environment_policies
        WHERE flag_id = $1
          AND environment = $2
          AND status = 'ACTIVE'`,
      [flagId, environment],
    );
    return result.rows[0] ? mapPolicy(result.rows[0]) : null;
  }

  async #findActiveRule(tenant, flagId, environment, target) {
    const { conditions, values } = buildTargetConditions(
      ['tenant_id = $1', 'flag_id = $2', "status = 'ACTIVE'"],
      [tenant, flagId],
      target,
    );
    values.push(environment);
    const environmentParameter = `$${values.length}`;
    conditions.push(`(environment = ${environmentParameter} OR environment IS NULL)`);

    const result = await this.query(
      `SELECT ${ruleColumns}
         FROM feature_flags.rules
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY CASE WHEN environment = ${environmentParameter} THEN 0 ELSE 1 END
        LIMIT 1`,
      values,
    );
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async #findActiveRuleByTarget(tenant, flagId, environment, target) {
    const { conditions, values } = buildTargetConditions(
      ['tenant_id = $1', 'flag_id = $2', "status = 'ACTIVE'"],
      [tenant, flagId],
      target,
    );
    values.push(environment);
    conditions.push(`environment IS NOT DISTINCT FROM $${values.length}`);

    const result = await this.query(
      `SELECT ${ruleColumns}
         FROM feature_flags.rules
        WHERE ${conditions.join('\n          AND ')}
        LIMIT 1`,
      values,
    );
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async #findRuleWithFlag(tenant, ruleId) {
    const result = await this.query(
      `SELECT
         r.id AS rule_id,
         r.tenant_id,
         r.flag_id,
         r.environment,
         r.target_type,
         r.company_id,
         r.branch_id,
         r.user_id,
         r.plan_key,
         r.enabled,
         r.rollout_basis_points,
         r.status AS rule_status,
         r.created_at,
         r.updated_at,
         r.version AS rule_version,
         f.key,
         f.name,
         f.description,
         f.default_enabled,
         f.status AS flag_status,
         f.hash_version,
         f.created_at AS flag_created_at,
         f.updated_at AS flag_updated_at,
         f.version AS flag_version
       FROM feature_flags.rules AS r
       JOIN feature_flags.flags AS f ON f.id = r.flag_id
      WHERE r.tenant_id = $1
        AND r.id = $2`,
      [tenant, ruleId],
    );
    if (!result.rows[0]) {
      return null;
    }
    const row = result.rows[0];
    return {
      rule: mapRule({
        id: row.rule_id,
        tenant_id: row.tenant_id,
        flag_id: row.flag_id,
        environment: row.environment,
        target_type: row.target_type,
        company_id: row.company_id,
        branch_id: row.branch_id,
        user_id: row.user_id,
        plan_key: row.plan_key,
        enabled: row.enabled,
        rollout_basis_points: row.rollout_basis_points,
        status: row.rule_status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        version: row.rule_version,
      }),
      flag: mapFlag({
        id: row.flag_id,
        key: row.key,
        name: row.name,
        description: row.description,
        default_enabled: row.default_enabled,
        status: row.flag_status,
        hash_version: row.hash_version,
        created_at: row.flag_created_at,
        updated_at: row.flag_updated_at,
        version: row.flag_version,
      }),
    };
  }

  async #findRuleVersion(tenant, ruleId, ruleVersion) {
    const result = await this.query(
      `SELECT rule_version, enabled, rollout_basis_points, status, change_type, reason, occurred_at
         FROM feature_flags.rule_versions
        WHERE tenant_id = $1
          AND rule_id = $2
          AND rule_version = $3`,
      [tenant, ruleId, ruleVersion],
    );
    if (!result.rows[0]) {
      return null;
    }
    return Object.freeze({
      ruleVersion: String(result.rows[0].rule_version),
      enabled: result.rows[0].enabled,
      rolloutBasisPoints: Number(result.rows[0].rollout_basis_points),
      status: result.rows[0].status,
      changeType: result.rows[0].change_type,
      reason: result.rows[0].reason,
      occurredAt: result.rows[0].occurred_at,
    });
  }

  async #assertEvaluationContext(tenant, context) {
    if (context.branchId) {
      await this.#assertTarget(tenant, normalizeFeatureFlagTarget({
        type: 'BRANCH',
        companyId: context.companyId,
        branchId: context.branchId,
      }));
    } else if (context.companyId) {
      await this.#assertTarget(tenant, normalizeFeatureFlagTarget({
        type: 'COMPANY',
        companyId: context.companyId,
      }));
    }
    if (context.userId) {
      await this.#assertTarget(tenant, normalizeFeatureFlagTarget({
        type: 'USER',
        userId: context.userId,
      }));
    }
  }

  async #assertTarget(tenant, target) {
    if (target.type === FEATURE_FLAG_TARGET.TENANT || target.type === FEATURE_FLAG_TARGET.PLAN) {
      return;
    }
    if (target.type === FEATURE_FLAG_TARGET.COMPANY) {
      const result = await this.query(
        `SELECT EXISTS (
           SELECT 1 FROM organization.companies
            WHERE tenant_id = $1 AND id = $2
         ) AS exists`,
        [tenant, target.companyId],
      );
      if (result.rows[0]?.exists !== true) {
        throw repositoryError(
          'MVT_FEATURE_FLAG_TARGET_NOT_FOUND',
          'Company was not found in the requested Tenant',
        );
      }
      return;
    }
    if (target.type === FEATURE_FLAG_TARGET.BRANCH) {
      const result = await this.query(
        `SELECT EXISTS (
           SELECT 1 FROM organization.branches
            WHERE tenant_id = $1 AND company_id = $2 AND id = $3
         ) AS exists`,
        [tenant, target.companyId, target.branchId],
      );
      if (result.rows[0]?.exists !== true) {
        throw repositoryError(
          'MVT_FEATURE_FLAG_TARGET_NOT_FOUND',
          'Branch was not found under the requested Tenant and Company',
        );
      }
      return;
    }
    const result = await this.query(
      `SELECT EXISTS (
         SELECT 1 FROM identity.memberships
          WHERE tenant_id = $1
            AND user_id = $2
            AND status = 'ACTIVE'
       ) AS exists`,
      [tenant, target.userId],
    );
    if (result.rows[0]?.exists !== true) {
      throw repositoryError(
        'MVT_FEATURE_FLAG_TARGET_NOT_FOUND',
        'User does not have an ACTIVE Membership in the requested Tenant',
      );
    }
  }
}

function normalizeEvaluationContext(input) {
  let companyId = null;
  let branchId = null;
  let userId = null;
  let planKey = null;

  if (input.branchId !== null && input.branchId !== undefined && input.branchId !== '') {
    const target = normalizeFeatureFlagTarget({
      type: 'BRANCH',
      companyId: input.companyId,
      branchId: input.branchId,
    });
    companyId = target.companyId;
    branchId = target.branchId;
  } else if (input.companyId !== null && input.companyId !== undefined && input.companyId !== '') {
    companyId = normalizeFeatureFlagTarget({
      type: 'COMPANY',
      companyId: input.companyId,
    }).companyId;
  }

  if (input.userId !== null && input.userId !== undefined && input.userId !== '') {
    userId = normalizeFeatureFlagTarget({ type: 'USER', userId: input.userId }).userId;
  }
  if (input.planKey !== null && input.planKey !== undefined && input.planKey !== '') {
    planKey = normalizeFeatureFlagTarget({ type: 'PLAN', planKey: input.planKey }).planKey;
  }

  return Object.freeze({ companyId, branchId, userId, planKey });
}

function buildEvaluationCandidates(context) {
  const candidates = [];
  if (context.userId) {
    candidates.push(normalizeFeatureFlagTarget({ type: 'USER', userId: context.userId }));
  }
  if (context.branchId) {
    candidates.push(normalizeFeatureFlagTarget({
      type: 'BRANCH',
      companyId: context.companyId,
      branchId: context.branchId,
    }));
  }
  if (context.companyId) {
    candidates.push(normalizeFeatureFlagTarget({ type: 'COMPANY', companyId: context.companyId }));
  }
  candidates.push(normalizeFeatureFlagTarget({ type: 'TENANT' }));
  if (context.planKey) {
    candidates.push(normalizeFeatureFlagTarget({ type: 'PLAN', planKey: context.planKey }));
  }
  return candidates;
}

function buildTargetConditions(initialConditions, initialValues, target) {
  const conditions = [...initialConditions, `target_type = $${initialValues.length + 1}`];
  const values = [...initialValues, target.type];

  if (target.type === FEATURE_FLAG_TARGET.TENANT) {
    conditions.push('company_id IS NULL', 'branch_id IS NULL', 'user_id IS NULL', 'plan_key IS NULL');
  } else if (target.type === FEATURE_FLAG_TARGET.COMPANY) {
    values.push(target.companyId);
    conditions.push(`company_id = $${values.length}`, 'branch_id IS NULL', 'user_id IS NULL', 'plan_key IS NULL');
  } else if (target.type === FEATURE_FLAG_TARGET.BRANCH) {
    values.push(target.companyId, target.branchId);
    conditions.push(
      `company_id = $${values.length - 1}`,
      `branch_id = $${values.length}`,
      'user_id IS NULL',
      'plan_key IS NULL',
    );
  } else if (target.type === FEATURE_FLAG_TARGET.USER) {
    values.push(target.userId);
    conditions.push('company_id IS NULL', 'branch_id IS NULL', `user_id = $${values.length}`, 'plan_key IS NULL');
  } else {
    values.push(target.planKey);
    conditions.push('company_id IS NULL', 'branch_id IS NULL', 'user_id IS NULL', `plan_key = $${values.length}`);
  }

  return { conditions, values };
}

function targetFromRule(rule) {
  return normalizeFeatureFlagTarget({
    type: rule.targetType,
    companyId: rule.companyId,
    branchId: rule.branchId,
    userId: rule.userId,
    planKey: rule.planKey,
  });
}

function normalizeOptionalEnvironment(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeFeatureFlagEnvironment(value);
}

function normalizeEnabled(value) {
  if (typeof value !== 'boolean') {
    throw repositoryError('MVT_FEATURE_FLAG_ENABLED_INVALID', 'Feature flag rule enabled must be boolean');
  }
  return value;
}

function mapFlag(row) {
  return Object.freeze({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    defaultEnabled: row.default_enabled,
    status: row.status,
    hashVersion: Number(row.hash_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  });
}

function mapPolicy(row) {
  return Object.freeze({
    id: row.id,
    flagId: row.flag_id,
    environment: row.environment,
    enabled: row.enabled,
    rolloutBasisPoints: Number(row.rollout_basis_points),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  });
}

function mapRule(row) {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    flagId: row.flag_id,
    environment: row.environment,
    targetType: row.target_type,
    companyId: row.company_id,
    branchId: row.branch_id,
    userId: row.user_id,
    planKey: row.plan_key,
    enabled: row.enabled,
    rolloutBasisPoints: Number(row.rollout_basis_points),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  });
}

function freezeDecision(value) {
  return Object.freeze({ ...value });
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
