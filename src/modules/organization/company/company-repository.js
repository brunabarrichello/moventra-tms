import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  COMPANY_STATUS,
  assertCompanyTransition,
  assertTenantAllowsCompanyActivation,
  normalizeCompanyCode,
  normalizeCompanyCreation,
  normalizeCompanyExpectedVersion,
  normalizeCompanyProfileUpdate,
} from './company-domain.js';

const companyColumns = `
  id,
  tenant_id,
  code,
  legal_name,
  display_name,
  registration_country,
  primary_tax_identifier_type,
  primary_tax_identifier,
  status,
  default_timezone,
  default_currency,
  created_at,
  updated_at,
  version
`;

export class PostgresCompanyRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Company repository query dependency must be a function');
    }

    this.query = query;
  }

  async create(tenantId, input) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const company = normalizeCompanyCreation(input);

    try {
      const result = await this.query(
        `INSERT INTO organization.companies (
           tenant_id,
           code,
           legal_name,
           display_name,
           registration_country,
           primary_tax_identifier_type,
           primary_tax_identifier,
           status,
           default_timezone,
           default_currency
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${companyColumns}`,
        [
          normalizedTenantId,
          company.code,
          company.legalName,
          company.displayName,
          company.registrationCountry,
          company.primaryTaxIdentifierType,
          company.primaryTaxIdentifier,
          company.status,
          company.defaultTimezone,
          company.defaultCurrency,
        ],
      );

      return mapCompanyRow(result.rows[0]);
    } catch (error) {
      throw mapCompanyWriteError(error, company);
    }
  }

  async findById(tenantId, id) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const companyId = normalizeUuid(id, 'company');
    const result = await this.query(
      `SELECT ${companyColumns}
         FROM organization.companies
        WHERE tenant_id = $1
          AND id = $2`,
      [normalizedTenantId, companyId],
    );

    return result.rows[0] ? mapCompanyRow(result.rows[0]) : null;
  }

  async findByCode(tenantId, code) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const normalizedCode = normalizeCompanyCode(code);
    const result = await this.query(
      `SELECT ${companyColumns}
         FROM organization.companies
        WHERE tenant_id = $1
          AND code = $2`,
      [normalizedTenantId, normalizedCode],
    );

    return result.rows[0] ? mapCompanyRow(result.rows[0]) : null;
  }

  async updateProfile(tenantId, id, input, expectedVersion) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const companyId = normalizeUuid(id, 'company');
    const profile = normalizeCompanyProfileUpdate(input);
    const version = normalizeCompanyExpectedVersion(expectedVersion);

    try {
      const result = await this.query(
        `UPDATE organization.companies
            SET legal_name = $3,
                display_name = $4,
                registration_country = $5,
                primary_tax_identifier_type = $6,
                primary_tax_identifier = $7,
                default_timezone = $8,
                default_currency = $9,
                updated_at = now(),
                version = version + 1
          WHERE tenant_id = $1
            AND id = $2
            AND version = $10
        RETURNING ${companyColumns}`,
        [
          normalizedTenantId,
          companyId,
          profile.legalName,
          profile.displayName,
          profile.registrationCountry,
          profile.primaryTaxIdentifierType,
          profile.primaryTaxIdentifier,
          profile.defaultTimezone,
          profile.defaultCurrency,
          version,
        ],
      );

      if (result.rows[0]) {
        return mapCompanyRow(result.rows[0]);
      }
    } catch (error) {
      throw mapCompanyWriteError(error, profile);
    }

    await this.#throwNotFoundOrConflict(normalizedTenantId, companyId);
  }

  async transitionStatus(tenantId, id, toStatus, expectedVersion) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const companyId = normalizeUuid(id, 'company');
    const version = normalizeCompanyExpectedVersion(expectedVersion);
    const current = await this.#findCompanyWithTenantStatus(normalizedTenantId, companyId);

    if (!current) {
      throw companyRepositoryError('MVT_COMPANY_NOT_FOUND', 'Company was not found in tenant scope');
    }

    if (current.version !== version) {
      throw companyRepositoryError(
        'MVT_COMPANY_VERSION_CONFLICT',
        'Company version does not match the expected version',
      );
    }

    assertCompanyTransition(current.status, toStatus);

    if (toStatus === COMPANY_STATUS.ACTIVE) {
      assertTenantAllowsCompanyActivation(current.tenantStatus);
    }

    const result = await this.query(
      `UPDATE organization.companies AS company
          SET status = $3,
              updated_at = now(),
              version = company.version + 1
        WHERE company.tenant_id = $1
          AND company.id = $2
          AND company.status = $4
          AND company.version = $5
          AND (
              $3 <> 'ACTIVE'
              OR EXISTS (
                  SELECT 1
                    FROM organization.tenants AS tenant
                   WHERE tenant.id = company.tenant_id
                     AND tenant.status = 'ACTIVE'
              )
          )
      RETURNING ${companyColumns}`,
      [normalizedTenantId, companyId, toStatus, current.status, version],
    );

    if (result.rows[0]) {
      return mapCompanyRow(result.rows[0]);
    }

    if (toStatus === COMPANY_STATUS.ACTIVE) {
      const latest = await this.#findCompanyWithTenantStatus(normalizedTenantId, companyId);

      if (latest && latest.version === version && latest.status === current.status) {
        assertTenantAllowsCompanyActivation(latest.tenantStatus);
      }
    }

    await this.#throwNotFoundOrConflict(normalizedTenantId, companyId);
  }

  async #findCompanyWithTenantStatus(tenantId, companyId) {
    const result = await this.query(
      `SELECT
           company.id,
           company.status,
           company.version,
           tenant.status AS tenant_status
         FROM organization.companies AS company
         JOIN organization.tenants AS tenant
           ON tenant.id = company.tenant_id
        WHERE company.tenant_id = $1
          AND company.id = $2`,
      [tenantId, companyId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      id: result.rows[0].id,
      status: result.rows[0].status,
      version: String(result.rows[0].version),
      tenantStatus: result.rows[0].tenant_status,
    };
  }

  async #throwNotFoundOrConflict(tenantId, companyId) {
    const result = await this.query(
      `SELECT version
         FROM organization.companies
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, companyId],
    );

    if (!result.rows[0]) {
      throw companyRepositoryError('MVT_COMPANY_NOT_FOUND', 'Company was not found in tenant scope');
    }

    throw companyRepositoryError(
      'MVT_COMPANY_VERSION_CONFLICT',
      'Company was modified by another operation',
    );
  }
}

function mapCompanyWriteError(error, company) {
  if (error?.code === '23505' && error?.constraint === 'uq_companies_tenant_id_code') {
    return companyRepositoryError(
      'MVT_COMPANY_CODE_CONFLICT',
      `Company code already exists in tenant scope: ${company.code}`,
    );
  }

  if (error?.code === '23505' && error?.constraint === 'uq_companies_tenant_tax_identifier') {
    return companyRepositoryError(
      'MVT_COMPANY_TAX_IDENTIFIER_CONFLICT',
      'Company tax identifier already exists in tenant scope',
    );
  }

  if (error?.code === '23503' && error?.constraint === 'fk_companies_tenant_id') {
    return companyRepositoryError('MVT_COMPANY_TENANT_NOT_FOUND', 'Owning tenant was not found');
  }

  return error;
}

function mapCompanyRow(row) {
  if (!row) {
    throw new Error('Company repository expected a database row');
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    legalName: row.legal_name,
    displayName: row.display_name,
    registrationCountry: row.registration_country.trim(),
    primaryTaxIdentifierType: row.primary_tax_identifier_type,
    primaryTaxIdentifier: row.primary_tax_identifier,
    status: row.status,
    defaultTimezone: row.default_timezone,
    defaultCurrency: row.default_currency?.trim() ?? null,
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
    throw companyRepositoryError(
      kind === 'tenant' ? 'MVT_COMPANY_TENANT_ID_INVALID' : 'MVT_COMPANY_ID_INVALID',
      `${kind === 'tenant' ? 'Tenant' : 'Company'} id must be a canonical UUID`,
    );
  }

  return value.toLowerCase();
}

function companyRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
