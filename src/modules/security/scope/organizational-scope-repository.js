import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import { normalizeScopeTarget } from './organizational-scope-domain.js';

export class PostgresOrganizationalScopeRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Organizational scope repository query dependency must be a function');
    }
    this.query = query;
  }

  async createScope(tenantId, input) {
    const tenant = normalizeUuid(tenantId);
    const scope = normalizeScopeTarget(input);
    const result = await this.query(
      `INSERT INTO security.organizational_scopes (
         tenant_id, scope_level, company_id, branch_id, status
       ) VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING id, tenant_id, scope_level, company_id, branch_id, status, version`,
      [tenant, scope.level, scope.companyId, scope.branchId],
    );
    return mapScope(result.rows[0]);
  }

  async assignScope(tenantId, assignmentId, scopeId) {
    const tenant = normalizeUuid(tenantId);
    const assignment = normalizeUuid(assignmentId);
    const scope = normalizeUuid(scopeId);
    try {
      await this.query(
        `INSERT INTO security.role_assignment_scopes (tenant_id, assignment_id, scope_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenant, assignment, scope],
      );
    } catch (error) {
      if (error?.code === '23503') {
        throw scopeRepositoryError('MVT_SCOPE_TENANT_MISMATCH', 'Assignment or scope does not belong to Tenant');
      }
      throw error;
    }
  }

  async hasScopedPermission(tenantId, membershipId, permissionCode, requestedScope) {
    const tenant = normalizeUuid(tenantId);
    const membership = normalizeUuid(membershipId);
    const permission = normalizePermissionCode(permissionCode);
    const requested = normalizeScopeTarget(requestedScope);
    const result = await this.query(
      `SELECT EXISTS (
         SELECT 1
           FROM identity.memberships AS m
           JOIN organization.tenants AS t ON t.id = m.tenant_id
           JOIN identity.users AS u ON u.id = m.user_id
           JOIN security.membership_roles AS mr
             ON mr.tenant_id = m.tenant_id AND mr.membership_id = m.id
           JOIN security.roles AS r
             ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
           JOIN security.role_permissions AS rp
             ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
           JOIN security.permissions AS p ON p.id = rp.permission_id
           JOIN security.role_assignment_scopes AS ras
             ON ras.tenant_id = mr.tenant_id AND ras.assignment_id = mr.id
           JOIN security.organizational_scopes AS os
             ON os.tenant_id = ras.tenant_id AND os.id = ras.scope_id
          WHERE m.tenant_id = $1
            AND m.id = $2
            AND p.code = $3
            AND m.status = 'ACTIVE'
            AND t.status = 'ACTIVE'
            AND u.status = 'ACTIVE'
            AND mr.status = 'ACTIVE'
            AND r.status = 'ACTIVE'
            AND p.status = 'ACTIVE'
            AND os.status = 'ACTIVE'
            AND (
              os.scope_level = 'TENANT'
              OR (os.scope_level = 'COMPANY' AND os.company_id = $5)
              OR (
                os.scope_level = 'BRANCH'
                AND $4 = 'BRANCH'
                AND os.company_id = $5
                AND os.branch_id = $6
              )
            )
       ) AS allowed`,
      [tenant, membership, permission, requested.level, requested.companyId, requested.branchId],
    );
    return result.rows[0]?.allowed === true;
  }
}

function mapScope(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    level: row.scope_level,
    companyId: row.company_id,
    branchId: row.branch_id,
    status: row.status,
    version: String(row.version),
  };
}

function normalizeUuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw scopeRepositoryError('MVT_SCOPE_ID_INVALID', 'Identifier must be a canonical UUID');
  }
  return value.toLowerCase();
}

function normalizePermissionCode(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.]{2,127}$/i.test(value.trim())) {
    throw scopeRepositoryError('MVT_SCOPE_PERMISSION_INVALID', 'Permission code is invalid');
  }
  return value.trim().toLowerCase();
}

function scopeRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
