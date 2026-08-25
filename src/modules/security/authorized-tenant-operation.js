import { normalizeTenantId, withTenantDatabaseTransaction } from '../../infrastructure/database/tenant-context.js';
import { PostgresAuditRepository } from '../audit/audit-repository.js';
import { AuthIdentityResolver } from '../identity/auth/auth-identity-resolver.js';
import { PostgresExternalIdentityRepository } from '../identity/auth/external-identity-repository.js';
import { PostgresMembershipRepository } from '../identity/membership/membership-repository.js';
import { PostgresUserRepository } from '../identity/user/user-repository.js';
import { AuthorizationService } from './rbac/authorization-service.js';
import { PostgresRbacRepository } from './rbac/rbac-repository.js';
import { normalizeScopeTarget } from './scope/organizational-scope-domain.js';
import { PostgresOrganizationalScopeRepository } from './scope/organizational-scope-repository.js';

const DENIED_CODE_PREFIXES = Object.freeze(['MVT_AUTH_', 'MVT_RBAC_', 'MVT_SCOPE_']);

export class AuthorizedTenantOperationService {
  constructor({
    transaction = withTenantDatabaseTransaction,
    componentsFactory = createSecurityComponents,
  } = {}) {
    if (typeof transaction !== 'function') {
      throw new TypeError('Authorized tenant operation transaction must be a function');
    }
    if (typeof componentsFactory !== 'function') {
      throw new TypeError('Authorized tenant operation componentsFactory must be a function');
    }

    this.transaction = transaction;
    this.componentsFactory = componentsFactory;
  }

  async execute(input, operation) {
    const request = normalizeAuthorizedOperation(input);
    if (typeof operation !== 'function') {
      throw authorizedOperationError(
        'MVT_SECURITY_OPERATION_INVALID',
        'Authorized tenant operation callback must be a function',
      );
    }

    let principal = null;

    try {
      return await this.transaction(request.tenantId, async (client, tenantId) => {
        const query = bindQuery(client);
        const components = validateComponents(this.componentsFactory(query));

        principal = await components.auth.resolveForTenant(
          request.verifiedAssertion,
          tenantId,
        );

        await components.authorization.requirePermission({
          tenantId,
          membershipId: principal.membership.id,
          permission: request.permission,
        });

        const scoped = await components.scopes.hasScopedPermission(
          tenantId,
          principal.membership.id,
          request.permission,
          request.scope,
        );

        if (!scoped) {
          throw authorizedOperationError(
            'MVT_SCOPE_FORBIDDEN',
            'Permission does not cover the requested organizational scope',
          );
        }

        const result = await operation(Object.freeze({
          tenantId,
          user: principal.user,
          membership: principal.membership,
          externalIdentity: principal.externalIdentity,
          permission: request.permission,
          scope: request.scope,
          query,
        }));

        await components.audit.append(buildAuditEvent({
          request,
          principal,
          outcome: 'SUCCESS',
          reason: null,
        }));

        return result;
      });
    } catch (caught) {
      const error = normalizeCaughtError(caught);
      await this.#recordNonSuccess(request, principal, error);
      throw error;
    }
  }

  async #recordNonSuccess(request, principal, originalError) {
    const outcome = isDeniedError(originalError) ? 'DENIED' : 'FAILED';

    try {
      await this.transaction(request.tenantId, async (client) => {
        const components = validateComponents(this.componentsFactory(bindQuery(client)));
        await components.audit.append(buildAuditEvent({
          request,
          principal,
          outcome,
          reason: safeFailureCode(originalError),
        }));
      });
    } catch (auditError) {
      if (Object.isExtensible(originalError)) {
        try {
          Object.defineProperty(originalError, 'auditFailureCode', {
            value: safeFailureCode(auditError),
            configurable: true,
            enumerable: false,
            writable: false,
          });
        } catch {
          // The primary business/security failure must never be replaced by audit fallback metadata.
        }
      }
    }
  }
}

export function createSecurityComponents(query) {
  if (typeof query !== 'function') {
    throw new TypeError('Security component query dependency must be a function');
  }

  const externalIdentities = new PostgresExternalIdentityRepository({ query });
  const users = new PostgresUserRepository({ query });
  const memberships = new PostgresMembershipRepository({ query });
  const rbac = new PostgresRbacRepository({ query });

  return Object.freeze({
    auth: new AuthIdentityResolver({ externalIdentities, users, memberships }),
    authorization: new AuthorizationService({ rbac }),
    scopes: new PostgresOrganizationalScopeRepository({ query }),
    audit: new PostgresAuditRepository({ query }),
  });
}

function normalizeAuthorizedOperation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw authorizedOperationError(
      'MVT_SECURITY_REQUEST_INVALID',
      'Authorized tenant operation input must be an object',
    );
  }

  const verifiedAssertion = normalizeVerifiedAssertion(input.verifiedAssertion);
  const permission = requireNonEmptyString(
    input.permission,
    'MVT_SECURITY_PERMISSION_INVALID',
    'Permission is required',
  ).toLowerCase();
  const scope = normalizeScopeTarget(input.scope);
  const audit = normalizeAuditDescriptor(input.audit);

  return Object.freeze({
    tenantId: normalizeTenantId(input.tenantId),
    verifiedAssertion,
    permission,
    scope: Object.freeze(scope),
    audit,
  });
}

function normalizeVerifiedAssertion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authorizedOperationError(
      'MVT_SECURITY_ASSERTION_INVALID',
      'verifiedAssertion must be supplied by a trusted authentication adapter',
    );
  }

  return Object.freeze({
    providerKey: requireNonEmptyString(
      value.providerKey,
      'MVT_SECURITY_ASSERTION_INVALID',
      'verifiedAssertion.providerKey is required',
    ),
    issuer: requireNonEmptyString(
      value.issuer,
      'MVT_SECURITY_ASSERTION_INVALID',
      'verifiedAssertion.issuer is required',
    ),
    subject: requireNonEmptyString(
      value.subject,
      'MVT_SECURITY_ASSERTION_INVALID',
      'verifiedAssertion.subject is required',
    ),
  });
}

function normalizeAuditDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authorizedOperationError(
      'MVT_SECURITY_AUDIT_INVALID',
      'Audit descriptor is required for authorized tenant operations',
    );
  }

  return Object.freeze({
    category: requireNonEmptyString(
      value.category,
      'MVT_SECURITY_AUDIT_INVALID',
      'Audit category is required',
    ),
    action: requireNonEmptyString(
      value.action,
      'MVT_SECURITY_AUDIT_INVALID',
      'Audit action is required',
    ),
    entityType: requireNonEmptyString(
      value.entityType,
      'MVT_SECURITY_AUDIT_INVALID',
      'Audit entityType is required',
    ),
    entityId: optionalString(value.entityId),
    requestId: optionalString(value.requestId),
    correlationId: optionalString(value.correlationId),
    beforeData: plainObjectOrEmpty(value.beforeData),
    afterData: plainObjectOrEmpty(value.afterData),
    metadata: plainObjectOrEmpty(value.metadata),
  });
}

function buildAuditEvent({ request, principal, outcome, reason }) {
  return {
    tenantId: request.tenantId,
    actorUserId: principal?.user?.id ?? null,
    actorMembershipId: principal?.membership?.id ?? null,
    companyId: request.scope.companyId,
    branchId: request.scope.branchId,
    category: request.audit.category,
    action: request.audit.action,
    entityType: request.audit.entityType,
    entityId: request.audit.entityId,
    outcome,
    requestId: request.audit.requestId,
    correlationId: request.audit.correlationId,
    reason,
    beforeData: request.audit.beforeData,
    afterData: request.audit.afterData,
    metadata: {
      ...request.audit.metadata,
      securityContext: {
        permission: request.permission,
        scopeLevel: request.scope.level,
        failureCode: reason,
      },
    },
  };
}

function bindQuery(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Authorized tenant operation requires a PostgreSQL transaction client');
  }
  return client.query.bind(client);
}

function validateComponents(components) {
  if (
    !components ||
    typeof components !== 'object' ||
    typeof components.auth?.resolveForTenant !== 'function' ||
    typeof components.authorization?.requirePermission !== 'function' ||
    typeof components.scopes?.hasScopedPermission !== 'function' ||
    typeof components.audit?.append !== 'function'
  ) {
    throw new TypeError('Authorized tenant operation components are incomplete');
  }
  return components;
}

function isDeniedError(error) {
  const code = safeFailureCode(error);
  return DENIED_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function safeFailureCode(error) {
  if (typeof error?.code === 'string' && /^[A-Z0-9_]{3,160}$/.test(error.code)) {
    return error.code;
  }
  return 'MVT_SECURITY_PIPELINE_FAILED';
}

function normalizeCaughtError(value) {
  if (value instanceof Error) {
    return value;
  }
  return authorizedOperationError(
    'MVT_SECURITY_PIPELINE_FAILED',
    'Authorized tenant operation failed',
  );
}

function requireNonEmptyString(value, code, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw authorizedOperationError(code, message);
  }
  return value.trim();
}

function optionalString(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw authorizedOperationError(
      'MVT_SECURITY_AUDIT_INVALID',
      'Optional audit text must be a string',
    );
  }
  const normalized = value.trim();
  return normalized || null;
}

function plainObjectOrEmpty(value) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authorizedOperationError(
      'MVT_SECURITY_AUDIT_INVALID',
      'Audit structured data must be an object',
    );
  }
  return value;
}

function authorizedOperationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
