import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  MEMBERSHIP_STATUS,
  assertMembershipActivationParents,
  assertMembershipTransition,
  normalizeMembershipExpectedVersion,
} from './membership-domain.js';

const membershipColumns = `
  id,
  tenant_id,
  user_id,
  status,
  created_at,
  updated_at,
  version
`;

export class PostgresMembershipRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Membership repository query dependency must be a function');
    }

    this.query = query;
  }

  async create(tenantId, userId) {
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const user = normalizeUuid(userId, 'USER');

    try {
      const result = await this.query(
        `INSERT INTO identity.memberships (tenant_id, user_id, status)
         VALUES ($1, $2, $3)
         RETURNING ${membershipColumns}`,
        [tenant, user, MEMBERSHIP_STATUS.PENDING],
      );

      return mapMembershipRow(result.rows[0]);
    } catch (error) {
      throw mapMembershipWriteError(error);
    }
  }

  async findById(tenantId, id) {
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const membershipId = normalizeUuid(id, 'ID');
    const result = await this.query(
      `SELECT ${membershipColumns}
         FROM identity.memberships
        WHERE tenant_id = $1
          AND id = $2`,
      [tenant, membershipId],
    );

    return result.rows[0] ? mapMembershipRow(result.rows[0]) : null;
  }

  async findByUserId(tenantId, userId) {
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const user = normalizeUuid(userId, 'USER');
    const result = await this.query(
      `SELECT ${membershipColumns}
         FROM identity.memberships
        WHERE tenant_id = $1
          AND user_id = $2`,
      [tenant, user],
    );

    return result.rows[0] ? mapMembershipRow(result.rows[0]) : null;
  }

  async transitionStatus(tenantId, id, toStatus, expectedVersion) {
    const tenant = normalizeUuid(tenantId, 'TENANT');
    const membershipId = normalizeUuid(id, 'ID');
    const version = normalizeMembershipExpectedVersion(expectedVersion);
    const current = await this.#findState(tenant, membershipId);

    if (!current) {
      throw membershipRepositoryError('MVT_MEMBERSHIP_NOT_FOUND', 'Membership was not found');
    }

    if (current.version !== version) {
      throw membershipRepositoryError(
        'MVT_MEMBERSHIP_VERSION_CONFLICT',
        'Membership version does not match the expected version',
      );
    }

    assertMembershipTransition(current.status, toStatus);

    if (toStatus === MEMBERSHIP_STATUS.ACTIVE) {
      assertMembershipActivationParents(current.tenantStatus, current.userStatus);
    }

    const result = await this.query(
      `UPDATE identity.memberships AS m
          SET status = $3,
              updated_at = now(),
              version = version + 1
        WHERE m.tenant_id = $1
          AND m.id = $2
          AND m.status = $4
          AND m.version = $5
          AND (
            $3 <> 'ACTIVE'
            OR (
              EXISTS (
                SELECT 1
                  FROM organization.tenants AS t
                 WHERE t.id = m.tenant_id
                   AND t.status = 'ACTIVE'
              )
              AND EXISTS (
                SELECT 1
                  FROM identity.users AS u
                 WHERE u.id = m.user_id
                   AND u.status = 'ACTIVE'
              )
            )
          )
      RETURNING ${membershipColumns}`,
      [tenant, membershipId, toStatus, current.status, version],
    );

    if (result.rows[0]) {
      return mapMembershipRow(result.rows[0]);
    }

    await this.#throwNotFoundConflictOrActivationBlocked(
      tenant,
      membershipId,
      version,
      toStatus,
    );
  }

  async #findState(tenantId, membershipId) {
    const result = await this.query(
      `SELECT m.status,
              m.version,
              t.status AS tenant_status,
              u.status AS user_status
         FROM identity.memberships AS m
         JOIN organization.tenants AS t ON t.id = m.tenant_id
         JOIN identity.users AS u ON u.id = m.user_id
        WHERE m.tenant_id = $1
          AND m.id = $2`,
      [tenantId, membershipId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      status: result.rows[0].status,
      version: String(result.rows[0].version),
      tenantStatus: result.rows[0].tenant_status,
      userStatus: result.rows[0].user_status,
    };
  }

  async #throwNotFoundConflictOrActivationBlocked(tenantId, membershipId, version, toStatus) {
    const current = await this.#findState(tenantId, membershipId);

    if (!current) {
      throw membershipRepositoryError('MVT_MEMBERSHIP_NOT_FOUND', 'Membership was not found');
    }

    if (current.version !== version) {
      throw membershipRepositoryError(
        'MVT_MEMBERSHIP_VERSION_CONFLICT',
        'Membership was modified by another operation',
      );
    }

    if (toStatus === MEMBERSHIP_STATUS.ACTIVE) {
      try {
        assertMembershipActivationParents(current.tenantStatus, current.userStatus);
      } catch (error) {
        if (
          error?.code === 'MVT_MEMBERSHIP_TENANT_NOT_OPERATIONAL' ||
          error?.code === 'MVT_MEMBERSHIP_USER_NOT_OPERATIONAL'
        ) {
          throw membershipRepositoryError(
            'MVT_MEMBERSHIP_ACTIVATION_BLOCKED',
            'Membership activation was blocked because Tenant or User is no longer operational',
          );
        }
        throw error;
      }
    }

    throw membershipRepositoryError(
      'MVT_MEMBERSHIP_CONCURRENT_CHANGE',
      'Membership state changed concurrently',
    );
  }
}

function mapMembershipWriteError(error) {
  if (error?.code === '23505' && error?.constraint === 'uq_memberships_tenant_user') {
    return membershipRepositoryError(
      'MVT_MEMBERSHIP_CONFLICT',
      'The User already has a Membership in this Tenant',
    );
  }

  if (error?.code === '23503' && error?.constraint === 'fk_memberships_tenant_id') {
    return membershipRepositoryError('MVT_MEMBERSHIP_TENANT_NOT_FOUND', 'Tenant was not found');
  }

  if (error?.code === '23503' && error?.constraint === 'fk_memberships_user_id') {
    return membershipRepositoryError('MVT_MEMBERSHIP_USER_NOT_FOUND', 'User was not found');
  }

  return error;
}

function mapMembershipRow(row) {
  if (!row) {
    throw new Error('Membership repository expected a database row');
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  };
}

function normalizeUuid(value, kind) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw membershipRepositoryError(
      `MVT_MEMBERSHIP_${kind}_INVALID`,
      `Membership ${kind.toLowerCase()} must be a canonical UUID`,
    );
  }

  return value.toLowerCase();
}

function membershipRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
