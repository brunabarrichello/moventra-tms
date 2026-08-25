import { queryDatabase } from '../../infrastructure/database/postgres.js';
import {
  CONFIGURATION_SCOPE,
  CONFIGURATION_STATUS,
  assertConfigurationScopeAllowed,
  normalizeConfigurationExpectedVersion,
  normalizeConfigurationKey,
  normalizeConfigurationReason,
  normalizeConfigurationScope,
  normalizeConfigurationValue,
} from './configuration-domain.js';

const definitionColumns = `
  id,
  key,
  owner_domain,
  name,
  description,
  value_type,
  default_value,
  validation_schema,
  allow_tenant_override,
  allow_company_override,
  allow_branch_override,
  sensitivity,
  status,
  version
`;

const settingColumns = `
  id,
  tenant_id,
  configuration_definition_id,
  scope_type,
  company_id,
  branch_id,
  value,
  status,
  created_at,
  updated_at,
  version
`;

export class PostgresConfigurationRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Configuration repository query dependency must be a function');
    }
    this.query = query;
  }

  async findActiveDefinitionByKey(key) {
    const normalizedKey = normalizeConfigurationKey(key);
    const result = await this.query(
      `SELECT ${definitionColumns}
         FROM configuration.definitions
        WHERE key = $1
          AND status = 'ACTIVE'`,
      [normalizedKey],
    );
    return result.rows[0] ? mapDefinition(result.rows[0]) : null;
  }

  async resolveEffective(tenantId, key, scopeInput) {
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const keyValue = normalizeConfigurationKey(key);
    const scope = normalizeConfigurationScope(scopeInput);
    await this.#assertOrganizationalTarget(tenant, scope);

    const definition = await this.findActiveDefinitionByKey(keyValue);
    if (!definition) {
      throw repositoryError(
        'MVT_CONFIGURATION_DEFINITION_NOT_FOUND',
        'Active configuration definition was not found',
      );
    }

    const candidates = buildResolutionCandidates(definition, scope);
    for (const candidate of candidates) {
      const setting = await this.#findActiveSetting(tenant, definition.id, candidate);
      if (setting) {
        const value = normalizeConfigurationValue(definition, setting.value);
        return Object.freeze({
          key: definition.key,
          value,
          source: candidate.type,
          tenantId: tenant,
          companyId: candidate.companyId,
          branchId: candidate.branchId,
          settingId: setting.id,
          settingVersion: setting.version,
          definitionVersion: definition.version,
        });
      }
    }

    if (definition.defaultValue !== null && definition.defaultValue !== undefined) {
      return Object.freeze({
        key: definition.key,
        value: normalizeConfigurationValue(definition, definition.defaultValue),
        source: 'DEFINITION_DEFAULT',
        tenantId: tenant,
        companyId: scope.companyId,
        branchId: scope.branchId,
        settingId: null,
        settingVersion: null,
        definitionVersion: definition.version,
      });
    }

    throw repositoryError(
      'MVT_CONFIGURATION_VALUE_MISSING',
      'No applicable configuration override or definition default exists',
    );
  }

  async putOverride(tenantId, key, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw repositoryError('MVT_CONFIGURATION_INPUT_INVALID', 'Configuration write input is invalid');
    }
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const keyValue = normalizeConfigurationKey(key);
    const scope = normalizeConfigurationScope(input.scope);
    const reason = normalizeConfigurationReason(input.reason);

    await this.#assertOrganizationalTarget(tenant, scope);
    const definition = await this.findActiveDefinitionByKey(keyValue);
    if (!definition) {
      throw repositoryError(
        'MVT_CONFIGURATION_DEFINITION_NOT_FOUND',
        'Active configuration definition was not found',
      );
    }
    assertConfigurationScopeAllowed(definition, scope);
    const value = normalizeConfigurationValue(definition, input.value);
    const current = await this.#findActiveSetting(tenant, definition.id, scope);

    if (input.expectedVersion === null || input.expectedVersion === undefined) {
      if (current) {
        throw repositoryError(
          'MVT_CONFIGURATION_VERSION_REQUIRED',
          'expectedVersion is required to update an existing override',
        );
      }
      return this.#createOverride({ tenant, definition, scope, value, reason });
    }

    const expectedVersion = normalizeConfigurationExpectedVersion(input.expectedVersion);
    if (!current) {
      throw repositoryError(
        'MVT_CONFIGURATION_SETTING_NOT_FOUND',
        'Active configuration override was not found',
      );
    }
    if (current.version !== expectedVersion) {
      throw repositoryError(
        'MVT_CONFIGURATION_VERSION_CONFLICT',
        'Configuration override version does not match expectedVersion',
      );
    }
    return this.#updateOverride({
      tenant,
      definition,
      current,
      value,
      expectedVersion,
      reason,
    });
  }

  async transitionOverrideStatus(tenantId, settingId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw repositoryError('MVT_CONFIGURATION_INPUT_INVALID', 'Configuration status input is invalid');
    }
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const id = normalizeUuid(settingId, 'SETTING');
    const requestedScope = normalizeConfigurationScope(input.scope);
    const expectedVersion = normalizeConfigurationExpectedVersion(input.expectedVersion);
    const reason = normalizeConfigurationReason(input.reason);
    const toStatus = String(input.toStatus ?? '').trim().toUpperCase();
    if (!Object.values(CONFIGURATION_STATUS).includes(toStatus)) {
      throw repositoryError('MVT_CONFIGURATION_STATUS_INVALID', 'Configuration setting status is invalid');
    }

    const current = await this.#findSettingWithDefinition(tenant, id);
    if (!current) {
      throw repositoryError('MVT_CONFIGURATION_SETTING_NOT_FOUND', 'Configuration setting was not found');
    }
    if (!sameScope(current.setting, requestedScope)) {
      throw repositoryError(
        'MVT_CONFIGURATION_SCOPE_MISMATCH',
        'Requested organizational scope does not match the configuration setting',
      );
    }
    await this.#assertOrganizationalTarget(tenant, requestedScope);
    if (current.setting.version !== expectedVersion) {
      throw repositoryError(
        'MVT_CONFIGURATION_VERSION_CONFLICT',
        'Configuration setting version does not match expectedVersion',
      );
    }
    if (current.setting.status === toStatus) {
      throw repositoryError(
        'MVT_CONFIGURATION_STATUS_CONFLICT',
        'Configuration setting is already in the requested status',
      );
    }
    if (toStatus === CONFIGURATION_STATUS.ACTIVE) {
      if (current.definition.status !== CONFIGURATION_STATUS.ACTIVE) {
        throw repositoryError(
          'MVT_CONFIGURATION_DEFINITION_NOT_OPERATIONAL',
          'Inactive configuration definition cannot activate an override',
        );
      }
      assertConfigurationScopeAllowed(current.definition, requestedScope);
      normalizeConfigurationValue(current.definition, current.setting.value);
    }

    let result;
    try {
      result = await this.query(
        `UPDATE configuration.settings
            SET status = $4,
                updated_at = now(),
                version = version + 1
          WHERE tenant_id = $1
            AND id = $2
            AND version = $3
        RETURNING ${settingColumns}`,
        [tenant, id, expectedVersion, toStatus],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw repositoryError(
          'MVT_CONFIGURATION_ACTIVE_CONFLICT',
          'Another active override already exists for this scope',
        );
      }
      throw error;
    }

    if (!result.rows[0]) {
      throw repositoryError(
        'MVT_CONFIGURATION_VERSION_CONFLICT',
        'Configuration setting changed concurrently',
      );
    }
    const setting = mapSetting(result.rows[0]);
    const changeType = toStatus === CONFIGURATION_STATUS.ACTIVE ? 'ACTIVATE' : 'INACTIVATE';
    await this.#appendVersion({
      tenant,
      setting,
      value: toStatus === CONFIGURATION_STATUS.ACTIVE ? setting.value : null,
      changeType,
      reason,
    });
    return Object.freeze({ setting, definition: current.definition, changeType });
  }

  async #createOverride({ tenant, definition, scope, value, reason }) {
    let result;
    try {
      result = await this.query(
        `INSERT INTO configuration.settings (
           tenant_id, configuration_definition_id, scope_type, company_id, branch_id, value, status
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'ACTIVE')
         RETURNING ${settingColumns}`,
        [tenant, definition.id, scope.type, scope.companyId, scope.branchId, JSON.stringify(value)],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw repositoryError(
          'MVT_CONFIGURATION_ACTIVE_CONFLICT',
          'An active override already exists for this configuration scope',
        );
      }
      if (error?.code === '23503') {
        throw repositoryError(
          'MVT_CONFIGURATION_SCOPE_NOT_FOUND',
          'Configuration organizational target does not belong to Tenant',
        );
      }
      throw error;
    }
    const setting = mapSetting(result.rows[0]);
    await this.#appendVersion({ tenant, setting, value: setting.value, changeType: 'CREATE', reason });
    return Object.freeze({ setting, definition, changeType: 'CREATE' });
  }

  async #updateOverride({ tenant, definition, current, value, expectedVersion, reason }) {
    const result = await this.query(
      `UPDATE configuration.settings
          SET value = $4::jsonb,
              updated_at = now(),
              version = version + 1
        WHERE tenant_id = $1
          AND id = $2
          AND version = $3
          AND status = 'ACTIVE'
      RETURNING ${settingColumns}`,
      [tenant, current.id, expectedVersion, JSON.stringify(value)],
    );
    if (!result.rows[0]) {
      throw repositoryError(
        'MVT_CONFIGURATION_VERSION_CONFLICT',
        'Configuration override changed concurrently',
      );
    }
    const setting = mapSetting(result.rows[0]);
    await this.#appendVersion({ tenant, setting, value: setting.value, changeType: 'UPDATE', reason });
    return Object.freeze({ setting, definition, changeType: 'UPDATE' });
  }

  async #appendVersion({ tenant, setting, value, changeType, reason }) {
    await this.query(
      `INSERT INTO configuration.setting_versions (
         tenant_id, setting_id, setting_version, value, status, change_type, reason
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        tenant,
        setting.id,
        setting.version,
        value === null ? null : JSON.stringify(value),
        setting.status,
        changeType,
        reason,
      ],
    );
  }

  async #findActiveSetting(tenant, definitionId, scope) {
    const conditions = ['tenant_id = $1', 'configuration_definition_id = $2', "status = 'ACTIVE'", 'scope_type = $3'];
    const values = [tenant, definitionId, scope.type];
    if (scope.type === CONFIGURATION_SCOPE.TENANT) {
      conditions.push('company_id IS NULL', 'branch_id IS NULL');
    } else if (scope.type === CONFIGURATION_SCOPE.COMPANY) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`, 'branch_id IS NULL');
    } else {
      values.push(scope.companyId, scope.branchId);
      conditions.push(`company_id = $${values.length - 1}`, `branch_id = $${values.length}`);
    }
    const result = await this.query(
      `SELECT ${settingColumns}
         FROM configuration.settings
        WHERE ${conditions.join('\n          AND ')}
        LIMIT 1`,
      values,
    );
    return result.rows[0] ? mapSetting(result.rows[0]) : null;
  }

  async #findSettingWithDefinition(tenant, settingId) {
    const result = await this.query(
      `SELECT
         s.id AS setting_id,
         s.tenant_id,
         s.configuration_definition_id,
         s.scope_type,
         s.company_id,
         s.branch_id,
         s.value,
         s.status AS setting_status,
         s.created_at,
         s.updated_at,
         s.version AS setting_version,
         d.id AS definition_id,
         d.key,
         d.owner_domain,
         d.name,
         d.description,
         d.value_type,
         d.default_value,
         d.validation_schema,
         d.allow_tenant_override,
         d.allow_company_override,
         d.allow_branch_override,
         d.sensitivity,
         d.status AS definition_status,
         d.version AS definition_version
       FROM configuration.settings AS s
       JOIN configuration.definitions AS d ON d.id = s.configuration_definition_id
      WHERE s.tenant_id = $1
        AND s.id = $2`,
      [tenant, settingId],
    );
    if (!result.rows[0]) {
      return null;
    }
    const row = result.rows[0];
    return {
      setting: mapSetting({
        id: row.setting_id,
        tenant_id: row.tenant_id,
        configuration_definition_id: row.configuration_definition_id,
        scope_type: row.scope_type,
        company_id: row.company_id,
        branch_id: row.branch_id,
        value: row.value,
        status: row.setting_status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        version: row.setting_version,
      }),
      definition: mapDefinition({
        id: row.definition_id,
        key: row.key,
        owner_domain: row.owner_domain,
        name: row.name,
        description: row.description,
        value_type: row.value_type,
        default_value: row.default_value,
        validation_schema: row.validation_schema,
        allow_tenant_override: row.allow_tenant_override,
        allow_company_override: row.allow_company_override,
        allow_branch_override: row.allow_branch_override,
        sensitivity: row.sensitivity,
        status: row.definition_status,
        version: row.definition_version,
      }),
    };
  }

  async #assertOrganizationalTarget(tenant, scope) {
    if (scope.type === CONFIGURATION_SCOPE.TENANT) {
      return;
    }
    if (scope.type === CONFIGURATION_SCOPE.COMPANY) {
      const result = await this.query(
        `SELECT EXISTS (
           SELECT 1 FROM organization.companies
            WHERE tenant_id = $1 AND id = $2
         ) AS exists`,
        [tenant, scope.companyId],
      );
      if (result.rows[0]?.exists !== true) {
        throw repositoryError(
          'MVT_CONFIGURATION_SCOPE_NOT_FOUND',
          'Company was not found in the requested Tenant',
        );
      }
      return;
    }
    const result = await this.query(
      `SELECT EXISTS (
         SELECT 1 FROM organization.branches
          WHERE tenant_id = $1
            AND company_id = $2
            AND id = $3
       ) AS exists`,
      [tenant, scope.companyId, scope.branchId],
    );
    if (result.rows[0]?.exists !== true) {
      throw repositoryError(
        'MVT_CONFIGURATION_SCOPE_NOT_FOUND',
        'Branch was not found under the requested Tenant and Company',
      );
    }
  }
}

function buildResolutionCandidates(definition, requested) {
  const candidates = [];
  if (requested.type === CONFIGURATION_SCOPE.BRANCH && definition.allowBranchOverride) {
    candidates.push(requested);
  }
  if (
    (requested.type === CONFIGURATION_SCOPE.BRANCH || requested.type === CONFIGURATION_SCOPE.COMPANY) &&
    definition.allowCompanyOverride
  ) {
    candidates.push(normalizeConfigurationScope({ type: 'COMPANY', companyId: requested.companyId }));
  }
  if (definition.allowTenantOverride) {
    candidates.push(normalizeConfigurationScope({ type: 'TENANT' }));
  }
  return candidates;
}

function sameScope(setting, scope) {
  return setting.scopeType === scope.type &&
    setting.companyId === scope.companyId &&
    setting.branchId === scope.branchId;
}

function mapDefinition(row) {
  return Object.freeze({
    id: row.id,
    key: row.key,
    ownerDomain: row.owner_domain,
    name: row.name,
    description: row.description,
    valueType: row.value_type,
    defaultValue: row.default_value,
    validationSchema: row.validation_schema,
    allowTenantOverride: row.allow_tenant_override === true,
    allowCompanyOverride: row.allow_company_override === true,
    allowBranchOverride: row.allow_branch_override === true,
    sensitivity: row.sensitivity,
    status: row.status,
    version: String(row.version),
  });
}

function mapSetting(row) {
  if (!row) {
    throw new Error('Configuration repository expected a setting row');
  }
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    definitionId: row.configuration_definition_id,
    scopeType: row.scope_type,
    companyId: row.company_id,
    branchId: row.branch_id,
    value: row.value,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  });
}

function normalizeUuid(value, kind) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw repositoryError(
      `MVT_CONFIGURATION_${kind}_INVALID`,
      `Configuration ${kind.toLowerCase()} identifier must be a canonical UUID`,
    );
  }
  return value.toLowerCase();
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
