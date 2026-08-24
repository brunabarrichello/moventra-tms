import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  normalizePermission,
  normalizePermissionCode,
  normalizeRbacExpectedVersion,
  normalizeRole,
  normalizeUuid,
} from './rbac-domain.js';

export class PostgresRbacRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('RBAC repository query dependency must be a function');
    }
    this.query = query;
  }

  async createPermission(input) {
    const permission = normalizePermission(input);
    try {
      const result = await this.query(
        `INSERT INTO security.permissions (code, description, status)
         VALUES ($1, $2, $3)
         RETURNING id, code, description, status, version`,
        [permission.code, permission.description, permission.status],
      );
      return mapPermission(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'uq_permissions_code') {
        throw repositoryError('MVT_RBAC_PERMISSION_CONFLICT', 'Permission code already exists');
      }
      throw error;
    }
  }

  async createRole(tenantId, input) {
    const tenant = normalizeUuid(tenantId, 'Tenant id');
    const role = normalizeRole(input);
    try {
      const result = await this.query(
        `INSERT INTO security.roles (tenant_id, code, name, description, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, code, name, description, status, version`,
        [tenant, role.code, role.name, role.description, role.status],
      );
      return mapRole(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'uq_roles_tenant_code') {
        throw repositoryError('MVT_RBAC_ROLE_CONFLICT', 'Role code already exists in Tenant');
      }
      if (error?.code === '23503') {
        throw repositoryError('MVT_RBAC_TENANT_NOT_FOUND', 'Tenant was not found');
      }
      throw error;
    }
  }

  async grantPermission(tenantId, roleId, permissionId) {
    const tenant = normalizeUuid(tenantId, 'Tenant id');
    const role = normalizeUuid(roleId, 'Role id');
    const permission = normalizeUuid(permissionId, 'Permission id');
    await this.query(
      `INSERT INTO security.role_permissions (tenant_id, role_id, permission_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tenant, role, permission],
    );
  }

  async assignRole(tenantId, membershipId, roleId) {
    const tenant = normalizeUuid(tenantId, 'Tenant id');
    const membership = normalizeUuid(membershipId, 'Membership id');
    const role = normalizeUuid(roleId, 'Role id');
    try {
      const result = await this.query(
        `INSERT INTO security.membership_roles (tenant_id, membership_id, role_id, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id, tenant_id, membership_id, role_id, status, version`,
        [tenant, membership, role],
      );
      return mapAssignment(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'uq_membership_roles_active') {
        throw repositoryError('MVT_RBAC_ASSIGNMENT_CONFLICT', 'Active role assignment already exists');
      }
      if (error?.code === '23503') {
        throw repositoryError('MVT_RBAC_SCOPE_MISMATCH', 'Membership or Role does not belong to Tenant');
      }
      throw error;
    }
  }

  async revokeAssignment(tenantId, assignmentId, expectedVersion) {
    const tenant = normalizeUuid(tenantId, 'Tenant id');
    const assignment = normalizeUuid(assignmentId, 'Assignment id');
    const version = normalizeRbacExpectedVersion(expectedVersion);
    const result = await this.query(
      `UPDATE security.membership_roles
          SET status = 'REVOKED', updated_at = now(), version = version + 1
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'ACTIVE'
          AND version = $3
      RETURNING id, tenant_id, membership_id, role_id, status, version`,
      [tenant, assignment, version],
    );
    if (!result.rows[0]) {
      throw repositoryError('MVT_RBAC_ASSIGNMENT_CONFLICT', 'Role assignment was not found or changed concurrently');
    }
    return mapAssignment(result.rows[0]);
  }

  async hasPermission(tenantId, membershipId, permissionCode) {
    const tenant = normalizeUuid(tenantId, 'Tenant id');
    const membership = normalizeUuid(membershipId, 'Membership id');
    const permission = normalizePermissionCode(permissionCode);
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
          WHERE m.tenant_id = $1
            AND m.id = $2
            AND m.status = 'ACTIVE'
            AND t.status = 'ACTIVE'
            AND u.status = 'ACTIVE'
            AND mr.status = 'ACTIVE'
            AND r.status = 'ACTIVE'
            AND p.status = 'ACTIVE'
            AND p.code = $3
       ) AS allowed`,
      [tenant, membership, permission],
    );
    return result.rows[0]?.allowed === true;
  }
}

function mapPermission(row) {
  return { id: row.id, code: row.code, description: row.description, status: row.status, version: String(row.version) };
}
function mapRole(row) {
  return { id: row.id, tenantId: row.tenant_id, code: row.code, name: row.name, description: row.description, status: row.status, version: String(row.version) };
}
function mapAssignment(row) {
  return { id: row.id, tenantId: row.tenant_id, membershipId: row.membership_id, roleId: row.role_id, status: row.status, version: String(row.version) };
}
function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
