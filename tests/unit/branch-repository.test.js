import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresBranchRepository } from '../../src/modules/organization/branch/branch-repository.js';

const tenantId = '0198f1c0-1234-7abc-8def-0123456789ab';
const otherTenantId = '0198f1c0-2234-7abc-8def-0123456789ab';
const companyId = '0198f1c0-3234-7abc-8def-0123456789ab';
const otherCompanyId = '0198f1c0-4234-7abc-8def-0123456789ab';
const branchId = '0198f1c0-5234-7abc-8def-0123456789ab';
const createdAt = new Date('2026-08-24T01:00:00.000Z');
const updatedAt = new Date('2026-08-24T01:00:00.000Z');

function branchRow(overrides = {}) {
  return {
    id: branchId,
    tenant_id: tenantId,
    company_id: companyId,
    code: 'campinas-sp',
    display_name: 'Campinas',
    is_headquarters: false,
    registration_country: 'BR',
    primary_tax_identifier_type: 'CNPJ',
    primary_tax_identifier: '12345678000270',
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
    code: 'campinas-sp',
    displayName: 'Campinas',
    isHeadquarters: false,
    registrationCountry: 'BR',
    primaryTaxIdentifierType: 'CNPJ',
    primaryTaxIdentifier: '12.345.678/0002-70',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'BRL',
    ...overrides,
  };
}

test('branch repository creates a normalized DRAFT branch inside explicit tenant/company scope', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [branchRow()] };
    },
  });

  const branch = await repository.create(
    tenantId,
    companyId,
    validCreation({ code: ' CAMPINAS-SP ' }),
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO organization\.branches/);
  assert.deepEqual(calls[0].values, [
    tenantId,
    companyId,
    'campinas-sp',
    'Campinas',
    false,
    'BR',
    'CNPJ',
    '12345678000270',
    'DRAFT',
    'America/Sao_Paulo',
    'BRL',
  ]);
  assert.equal(branch.tenantId, tenantId);
  assert.equal(branch.companyId, companyId);
  assert.equal(branch.status, 'DRAFT');
  assert.equal(branch.version, '1');
});

test('branch repository maps company-scoped code conflict', async () => {
  const repository = new PostgresBranchRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_branches_tenant_company_code';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, companyId, validCreation()),
    (error) => error.code === 'MVT_BRANCH_CODE_CONFLICT',
  );
});

test('branch repository maps headquarters uniqueness conflict', async () => {
  const repository = new PostgresBranchRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_branches_tenant_company_headquarters';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, companyId, validCreation({ isHeadquarters: true })),
    (error) => error.code === 'MVT_BRANCH_HEADQUARTERS_CONFLICT',
  );
});

test('branch repository maps missing owning company in tenant scope', async () => {
  const repository = new PostgresBranchRepository({
    query: async () => {
      const error = new Error('foreign key violation');
      error.code = '23503';
      error.constraint = 'fk_branches_company_scope';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, companyId, validCreation()),
    (error) => error.code === 'MVT_BRANCH_COMPANY_NOT_FOUND',
  );
});

test('branch reads are always tenant and company scoped', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [branchRow()] };
    },
  });

  const branch = await repository.findById(tenantId, companyId, branchId);

  assert.equal(branch.id, branchId);
  assert.match(calls[0].text, /WHERE tenant_id = \$1/);
  assert.match(calls[0].text, /AND company_id = \$2/);
  assert.match(calls[0].text, /AND id = \$3/);
  assert.deepEqual(calls[0].values, [tenantId, companyId, branchId]);
});

test('same branch id under another tenant or company cannot be returned', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  assert.equal(await repository.findById(otherTenantId, companyId, branchId), null);
  assert.equal(await repository.findById(tenantId, otherCompanyId, branchId), null);
  assert.deepEqual(calls[0].values, [otherTenantId, companyId, branchId]);
  assert.deepEqual(calls[1].values, [tenantId, otherCompanyId, branchId]);
});

test('profile update uses tenant, company, branch id and expected version for optimistic locking', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [branchRow({ display_name: 'Campinas Operacional', is_headquarters: true, version: '2' })],
      };
    },
  });

  const branch = await repository.updateProfile(
    tenantId,
    companyId,
    branchId,
    {
      displayName: 'Campinas Operacional',
      isHeadquarters: true,
      registrationCountry: 'BR',
      primaryTaxIdentifierType: 'CNPJ',
      primaryTaxIdentifier: '12.345.678/0002-70',
      defaultTimezone: null,
      defaultCurrency: null,
    },
    '1',
  );

  assert.equal(branch.version, '2');
  assert.match(calls[0].text, /WHERE tenant_id = \$1/);
  assert.match(calls[0].text, /AND company_id = \$2/);
  assert.match(calls[0].text, /AND id = \$3/);
  assert.match(calls[0].text, /AND version = \$11/);
  assert.match(calls[0].text, /version = version \+ 1/);
  assert.equal(calls[0].values.at(-1), '1');
});

test('wrong company profile update cannot discover or mutate a branch', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  await assert.rejects(
    () =>
      repository.updateProfile(
        tenantId,
        otherCompanyId,
        branchId,
        {
          displayName: 'Campinas',
          isHeadquarters: false,
          registrationCountry: null,
          primaryTaxIdentifierType: null,
          primaryTaxIdentifier: null,
          defaultTimezone: null,
          defaultCurrency: null,
        },
        '1',
      ),
    (error) => error.code === 'MVT_BRANCH_NOT_FOUND',
  );

  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.values[0] === tenantId), true);
  assert.equal(calls.every((call) => call.values[1] === otherCompanyId), true);
});

test('activation is atomic and requires tenant and company to remain ACTIVE', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.includes('company.status AS company_status')) {
        return {
          rows: [
            {
              id: branchId,
              status: 'DRAFT',
              version: '1',
              company_status: 'ACTIVE',
              tenant_status: 'ACTIVE',
            },
          ],
        };
      }

      return { rows: [branchRow({ status: 'ACTIVE', version: '2' })] };
    },
  });

  const branch = await repository.transitionStatus(tenantId, companyId, branchId, 'ACTIVE', '1');

  assert.equal(branch.status, 'ACTIVE');
  assert.equal(branch.version, '2');
  assert.match(calls[1].text, /EXISTS/);
  assert.match(calls[1].text, /company\.status = 'ACTIVE'/);
  assert.match(calls[1].text, /tenant\.status = 'ACTIVE'/);
  assert.match(calls[1].text, /branch\.tenant_id = \$1/);
  assert.match(calls[1].text, /branch\.company_id = \$2/);
  assert.deepEqual(calls[1].values, [tenantId, companyId, branchId, 'ACTIVE', 'DRAFT', '1']);
});

test('activation is rejected before update when parent company is not operational', async () => {
  const calls = [];
  const repository = new PostgresBranchRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [
          {
            id: branchId,
            status: 'DRAFT',
            version: '1',
            company_status: 'INACTIVE',
            tenant_status: 'ACTIVE',
          },
        ],
      };
    },
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, companyId, branchId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_BRANCH_COMPANY_NOT_OPERATIONAL',
  );

  assert.equal(calls.length, 1);
});

test('activation is rejected before update when parent tenant is not operational', async () => {
  const repository = new PostgresBranchRepository({
    query: async () => ({
      rows: [
        {
          id: branchId,
          status: 'DRAFT',
          version: '1',
          company_status: 'ACTIVE',
          tenant_status: 'SUSPENDED',
        },
      ],
    }),
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, companyId, branchId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_BRANCH_TENANT_NOT_OPERATIONAL',
  );
});

test('CLOSED branch cannot transition back to ACTIVE', async () => {
  const repository = new PostgresBranchRepository({
    query: async () => ({
      rows: [
        {
          id: branchId,
          status: 'CLOSED',
          version: '7',
          company_status: 'ACTIVE',
          tenant_status: 'ACTIVE',
        },
      ],
    }),
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, companyId, branchId, 'ACTIVE', '7'),
    (error) => error.code === 'MVT_BRANCH_TRANSITION_INVALID',
  );
});
