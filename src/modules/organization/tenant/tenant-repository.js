import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  assertTenantTransition,
  normalizeExpectedVersion,
  normalizeTenantCreation,
  normalizeTenantProfileUpdate,
} from './tenant-domain.js';

const tenantColumns = `
  id,
  code,
  display_name,
  status,
  default_timezone,
  default_currency,
  created_at,
  updated_at,
  version
`;

export class PostgresTenantRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Tenant repository query dependency must be a function');
    }

    this.query = query;
  }

  async create(input) {
    const tenant = normalizeTenantCreation(input);

    try {
      const result = await this.query(
        `INSERT INTO organization.tenants (
           code,
           display_name,
           status,
           default_timezone,
           default_currency
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${tenantColumns}`,
        [
          tenant.code,
          tenant.displayName,
          tenant.status,
          tenant.defaultTimezone,
          tenant.defaultCurrency,
        ],
      );

      return mapTenantRow(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'uq_tenants_code') {
        throw tenantRepositoryError(
          'MVT_TENANT_CODE_CONFLICT',
          `Tenant code already exists: ${tenant.code}`,
        );
      }

      throw error;
    }
  }

  async findById(id) {
    const tenantId = normalizeUuid(id);
    const result = await this.query(
      `SELECT ${tenantColumns}
         FROM organization.tenants
        WHERE id = $1`,
      [tenantId],
    );

    return result.rows[0] ? mapTenantRow(result.rows[0]) : null;
  }

  async findByCode(code) {
    const normalizedCode = normalizeTenantCreation({
      code,
      displayName: 'xx',
      defaultTimezone: 'UTC',
      defaultCurrency: 'USD',
    }).code;
    const result = await this.query(
      `SELECT ${tenantColumns}
         FROM organization.tenants
        WHERE code = $1`,
      [normalizedCode],
    );

    return result.rows[0] ? mapTenantRow(result.rows[0]) : null;
  }

  async updateProfile(id, input, expectedVersion) {
    const tenantId = normalizeUuid(id);
    const profile = normalizeTenantProfileUpdate(input);
    const version = normalizeExpectedVersion(expectedVersion);

    const result = await this.query(
      `UPDATE organization.tenants
          SET display_name = $2,
              default_timezone = $3,
              default_currency = $4,
              updated_at = now(),
              version = version + 1
        WHERE id = $1
          AND version = $5
      RETURNING ${tenantColumns}`,
      [tenantId, profile.displayName, profile.defaultTimezone, profile.defaultCurrency, version],
    );

    if (result.rows[0]) {
      return mapTenantRow(result.rows[0]);
    }

    await this.#throwNotFoundOrConflict(tenantId);
  }

  async transitionStatus(id, toStatus, expectedVersion) {
    const tenantId = normalizeUuid(id);
    const version = normalizeExpectedVersion(expectedVersion);
    const current = await this.findById(tenantId);

    if (!current) {
      throw tenantRepositoryError('MVT_TENANT_NOT_FOUND', 'Tenant was not found');
    }

    if (current.version !== version) {
      throw tenantRepositoryError(
        'MVT_TENANT_VERSION_CONFLICT',
        'Tenant version does not match the expected version',
      );
    }

    assertTenantTransition(current.status, toStatus);

    const result = await this.query(
      `UPDATE organization.tenants
          SET status = $2,
              updated_at = now(),
              version = version + 1
        WHERE id = $1
          AND status = $3
          AND version = $4
      RETURNING ${tenantColumns}`,
      [tenantId, toStatus, current.status, version],
    );

    if (result.rows[0]) {
      return mapTenantRow(result.rows[0]);
    }

    await this.#throwNotFoundOrConflict(tenantId);
  }

  async #throwNotFoundOrConflict(tenantId) {
    const result = await this.query(
      'SELECT version FROM organization.tenants WHERE id = $1',
      [tenantId],
    );

    if (!result.rows[0]) {
      throw tenantRepositoryError('MVT_TENANT_NOT_FOUND', 'Tenant was not found');
    }

    throw tenantRepositoryError(
      'MVT_TENANT_VERSION_CONFLICT',
      'Tenant was modified by another operation',
    );
  }
}

function mapTenantRow(row) {
  if (!row) {
    throw new Error('Tenant repository expected a database row');
  }

  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    status: row.status,
    defaultTimezone: row.default_timezone,
    defaultCurrency: row.default_currency.trim(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  };
}

function normalizeUuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw tenantRepositoryError('MVT_TENANT_ID_INVALID', 'Tenant id must be a canonical UUID');
  }

  return value.toLowerCase();
}

function tenantRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
