import {
  recordFeatureFlagEvaluation,
  recordFeatureFlagEvaluationError,
  recordFeatureFlagRuleWrite,
} from '../../infrastructure/observability/metrics.js';
import { AuthorizedTenantOperationService } from '../security/authorized-tenant-operation.js';
import {
  FEATURE_FLAG_STATUS,
  FEATURE_FLAG_TARGET,
  normalizeFeatureFlagKey,
  normalizeFeatureFlagTarget,
} from './feature-flag-domain.js';
import { PostgresFeatureFlagRepository } from './feature-flag-repository.js';

export class FeatureFlagEvaluator {
  constructor({
    environmentProvider = defaultEnvironmentProvider,
    planContextProvider = async () => null,
    repositoryFactory = (query) => new PostgresFeatureFlagRepository({ query }),
  } = {}) {
    if (typeof environmentProvider !== 'function') {
      throw new TypeError('Feature flag evaluator requires a trusted environment provider');
    }
    if (typeof planContextProvider !== 'function') {
      throw new TypeError('Feature flag evaluator requires a trusted plan context provider');
    }
    if (typeof repositoryFactory !== 'function') {
      throw new TypeError('Feature flag evaluator requires a repository factory');
    }
    this.environmentProvider = environmentProvider;
    this.planContextProvider = planContextProvider;
    this.repositoryFactory = repositoryFactory;
  }

  async evaluateAuthorizedContext(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw serviceError('MVT_FEATURE_FLAG_REQUEST_INVALID', 'Feature flag evaluation request must be an object');
    }
    const key = normalizeFeatureFlagKey(input.featureFlagKey);
    const context = normalizeAuthorizedContext(input.authorizedContext);
    const environment = await this.environmentProvider();
    const planValue = await this.planContextProvider(Object.freeze({
      tenantId: context.tenantId,
      user: context.user,
      membership: context.membership,
    }));
    const planKey = normalizeTrustedPlanValue(planValue);
    const repository = this.repositoryFactory(context.query);

    try {
      const result = await repository.evaluate(context.tenantId, key, {
        environment,
        userId: context.user.id,
        companyId: context.scope.companyId,
        branchId: context.scope.branchId,
        planKey,
      });
      recordFeatureFlagEvaluation({
        flagKey: key,
        source: result?.source ?? 'UNKNOWN',
        outcome: 'success',
        enabled: result?.enabled === true,
      });
      return result;
    } catch (error) {
      recordFeatureFlagEvaluationError({
        flagKey: key,
        reason: featureFlagEvaluationFailureReason(error),
      });
      recordFeatureFlagEvaluation({
        flagKey: key,
        source: 'UNKNOWN',
        outcome: 'failure',
        enabled: false,
      });
      throw error;
    }
  }
}

export class FeatureFlagAdministrationService {
  constructor({ security = new AuthorizedTenantOperationService() } = {}) {
    if (!security || typeof security.execute !== 'function') {
      throw new TypeError('Feature flag administration requires AuthorizedTenantOperationService');
    }
    this.security = security;
  }

  async putRule(input) {
    const request = normalizeAdministrationRequest(input);
    const key = normalizeFeatureFlagKey(input.featureFlagKey);
    const target = normalizeFeatureFlagTarget(input.target);
    const isUpdate = input.expectedVersion !== null && input.expectedVersion !== undefined;

    return withRuleWriteMetric(target.type, () => this.security.execute(
      {
        tenantId: request.tenantId,
        verifiedAssertion: request.verifiedAssertion,
        permission: 'feature_flags.rules.manage',
        scope: targetToSecurityScope(target),
        audit: {
          category: 'feature_flag',
          action: isUpdate ? 'feature_flag.rule.updated' : 'feature_flag.rule.created',
          entityType: 'feature_flag.rule',
          entityId: key,
          requestId: request.requestId,
          correlationId: request.correlationId,
          metadata: {
            featureFlagKey: key,
            targetType: target.type,
            environmentBound: input.environment !== null && input.environment !== undefined && input.environment !== '',
            rolloutBasisPoints: input.rolloutBasisPoints ?? 10000,
            valueIncluded: false,
          },
        },
      },
      async ({ tenantId, query }) => {
        const repository = new PostgresFeatureFlagRepository({ query });
        return repository.putRule(tenantId, key, {
          environment: input.environment,
          target,
          enabled: input.enabled,
          rolloutBasisPoints: input.rolloutBasisPoints,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        });
      },
    ));
  }

  async transitionRuleStatus(input) {
    const request = normalizeAdministrationRequest(input);
    const target = normalizeFeatureFlagTarget(input.target);
    const toStatus = String(input.toStatus ?? '').trim().toUpperCase();
    if (!Object.values(FEATURE_FLAG_STATUS).includes(toStatus)) {
      throw serviceError('MVT_FEATURE_FLAG_STATUS_INVALID', 'Feature flag rule status is invalid');
    }
    const action = toStatus === FEATURE_FLAG_STATUS.ACTIVE
      ? 'feature_flag.rule.activated'
      : 'feature_flag.rule.inactivated';

    return withRuleWriteMetric(target.type, () => this.security.execute(
      {
        tenantId: request.tenantId,
        verifiedAssertion: request.verifiedAssertion,
        permission: 'feature_flags.rules.manage',
        scope: targetToSecurityScope(target),
        audit: {
          category: 'feature_flag',
          action,
          entityType: 'feature_flag.rule',
          entityId: String(input.ruleId ?? ''),
          requestId: request.requestId,
          correlationId: request.correlationId,
          metadata: {
            targetType: target.type,
            targetStatus: toStatus,
            valueIncluded: false,
          },
        },
      },
      async ({ tenantId, query }) => {
        const repository = new PostgresFeatureFlagRepository({ query });
        return repository.transitionRuleStatus(tenantId, input.ruleId, {
          toStatus,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        });
      },
    ));
  }

  async restoreRuleVersion(input) {
    const request = normalizeAdministrationRequest(input);
    const target = normalizeFeatureFlagTarget(input.target);

    return withRuleWriteMetric(target.type, () => this.security.execute(
      {
        tenantId: request.tenantId,
        verifiedAssertion: request.verifiedAssertion,
        permission: 'feature_flags.rules.manage',
        scope: targetToSecurityScope(target),
        audit: {
          category: 'feature_flag',
          action: 'feature_flag.rule.restored',
          entityType: 'feature_flag.rule',
          entityId: String(input.ruleId ?? ''),
          requestId: request.requestId,
          correlationId: request.correlationId,
          metadata: {
            targetType: target.type,
            restoreVersion: String(input.restoreVersion ?? ''),
            valueIncluded: false,
          },
        },
      },
      async ({ tenantId, query }) => {
        const repository = new PostgresFeatureFlagRepository({ query });
        return repository.restoreRuleVersion(tenantId, input.ruleId, {
          expectedVersion: input.expectedVersion,
          restoreVersion: input.restoreVersion,
          reason: input.reason,
        });
      },
    ));
  }
}

async function withRuleWriteMetric(targetType, callback) {
  try {
    const result = await callback();
    recordFeatureFlagRuleWrite({ targetType, outcome: 'success' });
    return result;
  } catch (error) {
    recordFeatureFlagRuleWrite({
      targetType,
      outcome: isAuthorizationDenied(error) ? 'denied' : 'failure',
    });
    throw error;
  }
}

function featureFlagEvaluationFailureReason(error) {
  const code = String(error?.code ?? '').toUpperCase();
  if (code.includes('NOT_FOUND')) {
    return 'flag_not_found';
  }
  if (code.includes('INACTIVE')) {
    return 'flag_inactive';
  }
  if (code.includes('CONTEXT') || code.includes('REQUEST_INVALID')) {
    return 'context_invalid';
  }
  if (isAuthorizationDenied(error)) {
    return 'authorization_denied';
  }
  if (code.startsWith('MVT_DB_') || /^[0-9A-Z]{5}$/.test(code)) {
    return 'database_error';
  }
  return 'evaluation_failed';
}

function isAuthorizationDenied(error) {
  const code = String(error?.code ?? '').toUpperCase();
  return code.includes('DENIED') || code.includes('FORBIDDEN') || code.includes('UNAUTHORIZED');
}

function normalizeAuthorizedContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(
      'MVT_FEATURE_FLAG_AUTHORIZED_CONTEXT_INVALID',
      'Feature flag evaluation requires an already-authorized operation context',
    );
  }
  if (typeof value.query !== 'function') {
    throw serviceError(
      'MVT_FEATURE_FLAG_AUTHORIZED_CONTEXT_INVALID',
      'Authorized feature flag context must expose the transaction-bound query function',
    );
  }
  if (!value.user?.id || !value.membership?.id || !value.tenantId) {
    throw serviceError(
      'MVT_FEATURE_FLAG_AUTHORIZED_CONTEXT_INVALID',
      'Authorized feature flag context must contain Tenant, User and Membership',
    );
  }
  if (!value.scope || typeof value.scope !== 'object') {
    throw serviceError(
      'MVT_FEATURE_FLAG_AUTHORIZED_CONTEXT_INVALID',
      'Authorized feature flag context must contain Organizational Scope',
    );
  }

  return Object.freeze({
    tenantId: value.tenantId,
    user: value.user,
    membership: value.membership,
    scope: Object.freeze({
      level: value.scope.level,
      companyId: value.scope.companyId ?? null,
      branchId: value.scope.branchId ?? null,
    }),
    query: value.query,
  });
}

function normalizeAdministrationRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw serviceError('MVT_FEATURE_FLAG_REQUEST_INVALID', 'Feature flag request must be an object');
  }
  if (typeof input.tenantId !== 'string' || !input.tenantId.trim()) {
    throw serviceError('MVT_FEATURE_FLAG_TENANT_INVALID', 'tenantId is required');
  }
  if (!input.verifiedAssertion || typeof input.verifiedAssertion !== 'object') {
    throw serviceError(
      'MVT_FEATURE_FLAG_ASSERTION_INVALID',
      'verifiedAssertion from a trusted authentication adapter is required',
    );
  }
  return Object.freeze({
    tenantId: input.tenantId,
    verifiedAssertion: input.verifiedAssertion,
    requestId: optionalText(input.requestId),
    correlationId: optionalText(input.correlationId),
  });
}

function targetToSecurityScope(target) {
  if (target.type === FEATURE_FLAG_TARGET.COMPANY) {
    return { level: 'COMPANY', companyId: target.companyId, branchId: null };
  }
  if (target.type === FEATURE_FLAG_TARGET.BRANCH) {
    return { level: 'BRANCH', companyId: target.companyId, branchId: target.branchId };
  }
  return { level: 'TENANT', companyId: null, branchId: null };
}

function normalizeTrustedPlanValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeFeatureFlagTarget({ type: 'PLAN', planKey: value }).planKey;
}

function defaultEnvironmentProvider() {
  const environment = process.env.MOVENTRA_ENV ?? process.env.VERCEL_ENV ?? 'development';
  return environment;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw serviceError('MVT_FEATURE_FLAG_REQUEST_INVALID', 'Request metadata must be text');
  }
  return value.trim() || null;
}

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
