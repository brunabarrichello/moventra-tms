import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresCompanyRepository } from '../../src/modules/organization/company/company-repository.js';

const tenantId = '0198f1c0-1234-7abc-8def-0123456789ab';
const otherTenantId = '0198f1c0-2234-7abc-8def-0123456789ab';
const companyId = '0198f1c0-3234-7abc-8def-0123456789ab';
const createdAt = new Date('2026-08-24T00:00:00.000Z');
const updatedAt = new Date('2026-08-24T00:00:00.000Z');

function companyRow(overrides = {}) {
  return {
    id: companyId,
    tenant_id: tenantId,
    code: 'matriz-br',
    legal_name: 'ACME Logística S.A.',
    display_name: 'ACME Logística',
    registration_country: 'BR',
    primary_tax_identifier_type: 'CNPJ',
    primary_tax_identifier: '12345678000190',
    status: 'DRAFT',
    default_timezone: 'America/Sao_Paulo',
    default_currency: 'BRL',
    created_at: createdAt,
    updated_at: updatedAt,
    version: '1',
    ...overrides,
  };
}

function validCreation(overrides = {}) {
  return {
    code: 'matriz-br',
    legalName: 'ACME Logística S.A.',
    displayName: 'ACME Logística',
    registrationCountry: 'BR',
    primaryTaxIdentifierType: 'CNPJ',
    primaryTaxIdentifier: '12.345.678/0001-90',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'BRL',
    ...overrides,
  };
}

test('company repository creates a normalized DRAFT company inside an explicit tenant', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [companyRow()] };
    },
  });

  const company = await repository.create(tenantId, validCreation({ code: ' MATRIZ-BR ' }));

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO organization\.companies/);
  assert.deepEqual(calls[0].values, [
    tenantId,
    'matriz-br',
    'ACME Logística S.A.',
    'ACME Logística',
    'BR',
    'CNPJ',
    '12345678000190',
    'DRAFT',
    'America/Sao_Paulo',
    'BRL',
  ]);
  assert.equal(company.tenantId, tenantId);
  assert.equal(company.status, 'DRAFT');
  assert.equal(company.version, '1');
});

test('company repository maps tenant-scoped code conflict', async () => {
  const repository = new PostgresCompanyRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_companies_tenant_id_code';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, validCreation()),
    (error) => error.code === 'MVT_COMPANY_CODE_CONFLICT',
  );
});

test('company repository maps tenant-scoped tax identifier conflict', async () => {
  const repository = new PostgresCompanyRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_companies_tenant_tax_identifier';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, validCreation()),
    (error) => error.code === 'MVT_COMPANY_TAX_IDENTIFIER_CONFLICT',
  );
});

test('company repository maps missing owning tenant without leaking database details', async () => {
  const repository = new PostgresCompanyRepository({
    query: async () => {
      const error = new Error('foreign key violation');
      error.code = '23503';
      error.constraint = 'fk_companies_tenant_id';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, validCreation()),
    (error) => error.code === 'MVT_COMPANY_TENANT_NOT_FOUND',
  );
});

test('company reads are always tenant-scoped', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [companyRow()] };
    },
  });

  const company = await repository.findById(tenantId, companyId);

  assert.equal(company.id, companyId);
  assert.match(calls[0].text, /WHERE tenant_id = \$1/);
  assert.match(calls[0].text, /AND id = \$2/);
  assert.deepEqual(calls[0].values, [tenantId, companyId]);
});

test('same company id requested under another tenant cannot be returned', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  const company = await repository.findById(otherTenantId, companyId);

  assert.equal(company, null);
  assert.deepEqual(calls[0].values, [otherTenantId, companyId]);
});

test('profile update uses tenant, company id and expected version for optimistic locking', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [companyRow({ legal_name: 'ACME Transportes S.A.', version: '2' })],
      };
    },
  });

  const company = await repository.updateProfile(
    tenantId,
    companyId,
    {
      legalName: 'ACME Transportes S.A.',
      displayName: 'ACME',
      registrationCountry: 'BR',
      primaryTaxIdentifierType: 'CNPJ',
      primaryTaxIdentifier: '12.345.678/0001-90',
      defaultTimezone: null,
      defaultCurrency: null,
    },
    '1',
  );

  assert.equal(company.version, '2');
  assert.match(calls[0].text, /WHERE tenant_id = \$1/);
  assert.match(calls[0].text, /AND id = \$2/);
  assert.match(calls[0].text, /AND version = \$10/);
  assert.match(calls[0].text, /version = version \+ 1/);
  assert.equal(calls[0].values[0], tenantId);
  assert.equal(calls[0].values[1], companyId);
  assert.equal(calls[0].values.at(-1), '1');
});

test('stale profile update is surfaced as optimistic-lock conflict', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.startsWith('UPDATE')) {
        return { rows: [] };
      }

      return { rows: [{ version: '2' }] };
    },
  });

  await assert.rejects(
    () =>
      repository.updateProfile(
        tenantId,
        companyId,
        {
          legalName: 'ACME Transportes S.A.',
          displayName: null,
          registrationCountry: 'BR',
          primaryTaxIdentifierType: null,
          primaryTaxIdentifier: null,
          defaultTimezone: null,
          defaultCurrency: null,
        },
        '1',
      ),
    (error) => error.code === 'MVT_COMPANY_VERSION_CONFLICT',
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].values, [tenantId, companyId]);
});

test('wrong tenant profile update is not allowed to discover or mutate a company', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  await assert.rejects(
    () =>
      repository.updateProfile(
        otherTenantId,
        companyId,
        {
          legalName: 'ACME Transportes S.A.',
          displayName: null,
          registrationCountry: 'BR',
          primaryTaxIdentifierType: null,
          primaryTaxIdentifier: null,
          defaultTimezone: null,
          defaultCurrency: null,
        },
        '1',
      ),
    (error) => error.code === 'MVT_COMPANY_NOT_FOUND',
  );

  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.values[0] === otherTenantId), true);
});

test('activation is atomic and requires the parent tenant to remain ACTIVE', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.includes('JOIN organization.tenants')) {
        return {
          rows: [
            {
              id: companyId,
              status: 'DRAFT',
              version: '1',
              tenant_status: 'ACTIVE',
            },
          ],
        };
      }

      return { rows: [companyRow({ status: 'ACTIVE', version: '2' })] };
    },
  });

  const company = await repository.transitionStatus(tenantId, companyId, 'ACTIVE', '1');

  assert.equal(company.status, 'ACTIVE');
  assert.equal(company.version, '2');
  assert.match(calls[1].text, /EXISTS/);
  assert.match(calls[1].text, /tenant\.status = 'ACTIVE'/);
  assert.match(calls[1].text, /company\.tenant_id = \$1/);
  assert.deepEqual(calls[1].values, [tenantId, companyId, 'ACTIVE', 'DRAFT', '1']);
});

test('activation is rejected before update when parent tenant is not operational', async () => {
  const calls = [];
  const repository = new PostgresCompanyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [
          {
            id: companyId,
            status: 'DRAFT',
            version: '1',
            tenant_status: 'SUSPENDED',
          },
        ],
      };
    },
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, companyId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_COMPANY_TENANT_NOT_OPERATIONAL',
  );

  assert.equal(calls.length, 1);
});

test('CLOSED company cannot transition back to ACTIVE', async () => {
  const repository = new PostgresCompanyRepository({
    query: async () => ({
      rows: [
        {
          id: companyId,
          status: 'CLOSED',
          version: '7',
          tenant_status: 'ACTIVE',
        },
      ],
    }),
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, companyId, 'ACTIVE', '7'),
    (error) => error.code === 'MVT_COMPANY_TRANSITION_INVALID',
  );
});
