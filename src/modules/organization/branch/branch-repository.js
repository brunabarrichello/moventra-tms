import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  BRANCH_STATUS,
  assertBranchTransition,
  assertParentsAllowBranchActivation,
  normalizeBranchCode,
  normalizeBranchCreation,
  normalizeBranchExpectedVersion,
  normalizeBranchProfileUpdate,
} from './branch-domain.js';

const branchColumns = `
  id,
  tenant_id,
  company_id,
  code,
  display_name,
  is_headquarters,
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

export class PostgresBranchRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Branch repository query dependency must be a function');
    }

    this.query = query;
  }

  async create(tenantId, companyId, input) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const normalizedCompanyId = normalizeUuid(companyId, 'company');
    const branch = normalizeBranchCreation(input);

    try {
      const result = await this.query(
        `INSERT INTO organization.branches (
           tenant_id,
           company_id,
           code,
           display_name,
           is_headquarters,
           registration_country,
           primary_tax_identifier_type,
           primary_tax_identifier,
           status,
           default_timezone,
           default_currency
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${branchColumns}`,
        [
          normalizedTenantId,
          normalizedCompanyId,
          branch.code,
          branch.displayName,
          branch.isHeadquarters,
          branch.registrationCountry,
          branch.primaryTaxIdentifierType,
          branch.primaryTaxIdentifier,
          branch.status,
          branch.defaultTimezone,
          branch.defaultCurrency,
        ],
      );

      return mapBranchRow(result.rows[0]);
    } catch (error) {
      throw mapBranchWriteError(error, branch);
    }
  }

  async findById(tenantId, companyId, id) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const normalizedCompanyId = normalizeUuid(companyId, 'company');
    const branchId = normalizeUuid(id, 'branch');
    const result = await this.query(
      `SELECT ${branchColumns}
         FROM organization.branches
        WHERE tenant_id = $1
          AND company_id = $2
          AND id = $3`,
      [normalizedTenantId, normalizedCompanyId, branchId],
    );

    return result.rows[0] ? mapBranchRow(result.rows[0]) : null;
  }

  async findByCode(tenantId, companyId, code) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const normalizedCompanyId = normalizeUuid(companyId, 'company');
    const normalizedCode = normalizeBranchCode(code);
    const result = await this.query(
      `SELECT ${branchColumns}
         FROM organization.branches
        WHERE tenant_id = $1
          AND company_id = $2
          AND code = $3`,
      [normalizedTenantId, normalizedCompanyId, normalizedCode],
    );

    return result.rows[0] ? mapBranchRow(result.rows[0]) : null;
  }

  async updateProfile(tenantId, companyId, id, input, expectedVersion) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const normalizedCompanyId = normalizeUuid(companyId, 'company');
    const branchId = normalizeUuid(id, 'branch');
    const profile = normalizeBranchProfileUpdate(input);
    const version = normalizeBranchExpectedVersion(expectedVersion);

    try {
      const result = await this.query(
        `UPDATE organization.branches
            SET display_name = $4,
                is_headquarters = $5,
                registration_country = $6,
                primary_tax_identifier_type = $7,
                primary_tax_identifier = $8,
                default_timezone = $9,
                default_currency = $10,
                updated_at = now(),
                version = version + 1
          WHERE tenant_id = $1
            AND company_id = $2
            AND id = $3
            AND version = $11
        RETURNING ${branchColumns}`,
        [
          normalizedTenantId,
          normalizedCompanyId,
          branchId,
          profile.displayName,
          profile.isHeadquarters,
          profile.registrationCountry,
          profile.primaryTaxIdentifierType,
          profile.primaryTaxIdentifier,
          profile.defaultTimezone,
          profile.defaultCurrency,
          version,
        ],
      );

      if (result.rows[0]) {
        return mapBranchRow(result.rows[0]);
      }
    } catch (error) {
      throw mapBranchWriteError(error, profile);
    }

    await this.#throwNotFoundOrConflict(normalizedTenantId, normalizedCompanyId, branchId);
  }

  async transitionStatus(tenantId, companyId, id, toStatus, expectedVersion) {
    const normalizedTenantId = normalizeUuid(tenantId, 'tenant');
    const normalizedCompanyId = normalizeUuid(companyId, 'company');
    const branchId = normalizeUuid(id, 'branch');
    const version = normalizeBranchExpectedVersion(expectedVersion);
    const current = await this.#findBranchWithParentStatuses(
      normalizedTenantId,
      normalizedCompanyId,
      branchId,
    );

    if (!current) {
      throw branchRepositoryError(
        'MVT_BRANCH_NOT_FOUND',
        'Branch was not found in tenant/company scope',
      );
    }

    if (current.version !== version) {
      throw branchRepositoryError(
        'MVT_BRANCH_VERSION_CONFLICT',
        'Branch version does not match the expected version',
      );
    }

    assertBranchTransition(current.status, toStatus);

    if (toStatus === BRANCH_STATUS.ACTIVE) {
      assertParentsAllowBranchActivation(current.tenantStatus, current.companyStatus);
    }

    const result = await this.query(
      `UPDATE organization.branches AS branch
          SET status = $4,
              updated_at = now(),
              version = branch.version + 1
        WHERE branch.tenant_id = $1
          AND branch.company_id = $2
          AND branch.id = $3
          AND branch.status = $5
          AND branch.version = $6
          AND (
              $4 <> 'ACTIVE'
              OR EXISTS (
                  SELECT 1
                    FROM organization.companies AS company
                    JOIN organization.tenants AS tenant
                      ON tenant.id = company.tenant_id
                   WHERE company.tenant_id = branch.tenant_id
                     AND company.id = branch.company_id
                     AND company.status = 'ACTIVE'
                     AND tenant.status = 'ACTIVE'
              )
          )
      RETURNING ${branchColumns}`,
      [
        normalizedTenantId,
        normalizedCompanyId,
        branchId,
        toStatus,
        current.status,
        version,
      ],
    );

    if (result.rows[0]) {
      return mapBranchRow(result.rows[0]);
    }

    if (toStatus === BRANCH_STATUS.ACTIVE) {
      const latest = await this.#findBranchWithParentStatuses(
        normalizedTenantId,
        normalizedCompanyId,
        branchId,
      );

      if (latest && latest.version === version && latest.status === current.status) {
        assertParentsAllowBranchActivation(latest.tenantStatus, latest.companyStatus);
      }
    }

    await this.#throwNotFoundOrConflict(normalizedTenantId, normalizedCompanyId, branchId);
  }

  async #findBranchWithParentStatuses(tenantId, companyId, branchId) {
    const result = await this.query(
      `SELECT
           branch.id,
           branch.status,
           branch.version,
           company.status AS company_status,
           tenant.status AS tenant_status
         FROM organization.branches AS branch
         JOIN organization.companies AS company
           ON company.tenant_id = branch.tenant_id
          AND company.id = branch.company_id
         JOIN organization.tenants AS tenant
           ON tenant.id = branch.tenant_id
        WHERE branch.tenant_id = $1
          AND branch.company_id = $2
          AND branch.id = $3`,
      [tenantId, companyId, branchId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      id: result.rows[0].id,
      status: result.rows[0].status,
      version: String(result.rows[0].version),
      companyStatus: result.rows[0].company_status,
      tenantStatus: result.rows[0].tenant_status,
    };
  }

  async #throwNotFoundOrConflict(tenantId, companyId, branchId) {
    const result = await this.query(
      `SELECT version
         FROM organization.branches
        WHERE tenant_id = $1
          AND company_id = $2
          AND id = $3`,
      [tenantId, companyId, branchId],
    );

    if (!result.rows[0]) {
      throw branchRepositoryError(
        'MVT_BRANCH_NOT_FOUND',
        'Branch was not found in tenant/company scope',
      );
    }

    throw branchRepositoryError(
      'MVT_BRANCH_VERSION_CONFLICT',
      'Branch was modified by another operation',
    );
  }
}

function mapBranchWriteError(error, branch) {
  if (error?.code === '23505' && error?.constraint === 'uq_branches_tenant_company_code') {
    return branchRepositoryError(
      'MVT_BRANCH_CODE_CONFLICT',
      `Branch code already exists in company scope: ${branch.code ?? 'unknown'}`,
    );
  }

  if (
    error?.code === '23505' &&
    error?.constraint === 'uq_branches_tenant_company_headquarters'
  ) {
    return branchRepositoryError(
      'MVT_BRANCH_HEADQUARTERS_CONFLICT',
      'Owning company already has another headquarters branch',
    );
  }

  if (error?.code === '23505' && error?.constraint === 'uq_branches_tenant_tax_identifier') {
    return branchRepositoryError(
      'MVT_BRANCH_TAX_IDENTIFIER_CONFLICT',
      'Branch tax identifier already exists in tenant scope',
    );
  }

  if (error?.code === '23503' && error?.constraint === 'fk_branches_company_scope') {
    return branchRepositoryError(
      'MVT_BRANCH_COMPANY_NOT_FOUND',
      'Owning company was not found in tenant scope',
    );
  }

  return error;
}

function mapBranchRow(row) {
  if (!row) {
    throw new Error('Branch repository expected a database row');
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    code: row.code,
    displayName: row.display_name,
    isHeadquarters: row.is_headquarters,
    registrationCountry: row.registration_country?.trim() ?? null,
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
    const code =
      kind === 'tenant'
        ? 'MVT_BRANCH_TENANT_ID_INVALID'
        : kind === 'company'
          ? 'MVT_BRANCH_COMPANY_ID_INVALID'
          : 'MVT_BRANCH_ID_INVALID';
    const label = kind === 'tenant' ? 'Tenant' : kind === 'company' ? 'Company' : 'Branch';
    throw branchRepositoryError(code, `${label} id must be a canonical UUID`);
  }

  return value.toLowerCase();
}

function branchRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
