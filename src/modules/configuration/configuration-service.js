import { AuthorizedTenantOperationService } from '../security/authorized-tenant-operation.js';
import {
  CONFIGURATION_STATUS,
  normalizeConfigurationKey,
  normalizeConfigurationScope,
  scopeFromConfigurationContext,
} from './configuration-domain.js';
import { PostgresConfigurationRepository } from './configuration-repository.js';

export class ConfigurationService {
  constructor({ security = new AuthorizedTenantOperationService() } = {}) {
    if (!security || typeof security.execute !== 'function') {
      throw new TypeError('Configuration service requires AuthorizedTenantOperationService');
    }
    this.security = security;
  }

  async resolveEffective(input) {
    const request = normalizeBaseRequest(input);
    const key = normalizeConfigurationKey(input.configurationKey);
    const scope = scopeFromConfigurationContext({
      companyId: input.companyId,
      branchId: input.branchId,
    });

    return this.security.execute(
      {
        tenantId: request.tenantId,
        verifiedAssertion: request.verifiedAssertion,
        permission: 'configuration.settings.read',
        scope: toSecurityScope(scope),
        audit: {
          category: 'configuration',
          action: 'configuration.effective.resolved',
          entityType: 'configuration.definition',
          entityId: key,
          requestId: request.requestId,
          correlationId: request.correlationId,
          metadata: {
            configurationKey: key,
            scopeType: scope.type,
          },
        },
      },
      async ({ tenantId, query }) => {
        const repository = new PostgresConfigurationRepository({ query });
        return repository.resolveEffective(tenantId, key, scope);
      },
    );
  }

  async putOverride(input) {
    const request = normalizeBaseRequest(input);
    const key = normalizeConfigurationKey(input.configurationKey);
    const scope = normalizeConfigurationScope(input.scope);
    const isUpdate = input.expectedVersion !== null && input.expectedVersion !== undefined;

    return this.security.execute(
      {
        tenantId: request.tenantId,
        verifiedAssertion: request.verifiedAssertion,
        permission: 'configuration.settings.manage',
        scope: toSecurityScope(scope),
        audit: {
          category: 'configuration',
          action: isUpdate ? 'configuration.setting.updated' : 'configuration.setting.created',
          entityType: 'configuration.setting',
          entityId: key,
          requestId: request.requestId,
          correlationId: request.correlationId,
          metadata: {
            configurationKey: key,
            scopeType: scope.type,
            valueIncluded: false,
          },
        },
      },
      async ({ tenantId, query }) => {
        const repository = new PostgresConfigurationRepository({ query });
        return repository.putOverride(tenantId, key, {
          scope,
          value: input.value,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        });
      },
    );
  }

  async transitionOverrideStatus(input) {
    const request = normalizeBaseRequest(input);
    const scope = normalizeConfigurationScope(input.scope);
    const toStatus = String(input.toStatus ?? '').trim().toUpperCase();
    if (!Object.values(CONFIGURATION_STATUS).includes(toStatus)) {
      throw serviceError('MVT_CONFIGURATION_STATUS_INVALID', 'Configuration setting status is invalid');
    }
    const action = toStatus === CONFIGURATION_STATUS.ACTIVE
      ? 'configuration.setting.activated'
      : 'configuration.setting.inactivated';

    return this.security.execute(
      {
        tenantId: request.tenantId,
        verifiedAssertion: request.verifiedAssertion,
        permission: 'configuration.settings.manage',
        scope: toSecurityScope(scope),
        audit: {
          category: 'configuration',
          action,
          entityType: 'configuration.setting',
          entityId: String(input.settingId ?? ''),
          requestId: request.requestId,
          correlationId: request.correlationId,
          metadata: {
            scopeType: scope.type,
            targetStatus: toStatus,
            valueIncluded: false,
          },
        },
      },
      async ({ tenantId, query }) => {
        const repository = new PostgresConfigurationRepository({ query });
        return repository.transitionOverrideStatus(tenantId, input.settingId, {
          scope,
          toStatus,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        });
      },
    );
  }
}

function normalizeBaseRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw serviceError('MVT_CONFIGURATION_REQUEST_INVALID', 'Configuration request must be an object');
  }
  if (typeof input.tenantId !== 'string' || !input.tenantId.trim()) {
    throw serviceError('MVT_CONFIGURATION_TENANT_INVALID', 'tenantId is required');
  }
  if (!input.verifiedAssertion || typeof input.verifiedAssertion !== 'object') {
    throw serviceError(
      'MVT_CONFIGURATION_ASSERTION_INVALID',
      'verifiedAssertion from a trusted authentication adapter is required',
    );
  }
  return {
    tenantId: input.tenantId,
    verifiedAssertion: input.verifiedAssertion,
    requestId: optionalText(input.requestId),
    correlationId: optionalText(input.correlationId),
  };
}

function toSecurityScope(scope) {
  return {
    level: scope.type,
    companyId: scope.companyId,
    branchId: scope.branchId,
  };
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw serviceError('MVT_CONFIGURATION_REQUEST_INVALID', 'Request metadata must be text');
  }
  return value.trim() || null;
}

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
