import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresConfigurationRepository } from '../../src/modules/configuration/configuration-repository.js';

const tenantId = '01990180-0000-7000-8000-000000000001';
const companyId = '01990180-0000-7000-8000-000000000011';
const branchId = '01990180-0000-7000-8000-000000000021';
const definitionId = '01990180-0000-7000-8000-000000000100';

function definitionRow(overrides = {}) {
  return {
    id: definitionId,
    key: 'operations.tracking.enabled',
    owner_domain: 'operations',
    name: 'Tracking enabled',
    description: null,
    value_type: 'BOOLEAN',
    default_value: false,
    validation_schema: {},
    allow_tenant_override: true,
    allow_company_override: true,
    allow_branch_override: true,
    sensitivity: 'INTERNAL',
    status: 'ACTIVE',
    version: 1,
    ...overrides,
  };
}

function settingRow(scopeType, value, version = 1) {
  return {
    id: scopeType === 'BRANCH'
      ? '01990180-0000-7000-8000-000000000103'
      : scopeType === 'COMPANY'
        ? '01990180-0000-7000-8000-000000000102'
        : '01990180-0000-7000-8000-000000000101',
    tenant_id: tenantId,
    configuration_definition_id: definitionId,
    scope_type: scopeType,
    company_id: scopeType === 'TENANT' ? null : companyId,
    branch_id: scopeType === 'BRANCH' ? branchId : null,
    value,
    status: 'ACTIVE',
    created_at: new Date('2026-08-25T00:00:00Z'),
    updated_at: new Date('2026-08-25T00:00:00Z'),
    version,
  };
}

test('resolver returns Branch override before Company, Tenant and default', async () => {
  const query = async (sql, values) => {
    if (sql.includes('FROM organization.branches')) {
      return { rows: [{ exists: true }] };
    }
    if (sql.includes('FROM configuration.definitions')) {
      return { rows: [definitionRow()] };
    }
    if (sql.includes('FROM configuration.settings')) {
      assert.equal(values[2], 'BRANCH');
      return { rows: [settingRow('BRANCH', true, 3)] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresConfigurationRepository({ query });
  const resolved = await repository.resolveEffective(
    tenantId,
    'operations.tracking.enabled',
    { type: 'BRANCH', companyId, branchId },
  );

  assert.equal(resolved.value, true);
  assert.equal(resolved.source, 'BRANCH');
  assert.equal(resolved.settingVersion, '3');
  assert.equal(resolved.definitionVersion, '1');
});

test('resolver falls back from Branch to Company and then Tenant', async () => {
  const scopes = [];
  const query = async (sql, values) => {
    if (sql.includes('FROM organization.branches')) {
      return { rows: [{ exists: true }] };
    }
    if (sql.includes('FROM configuration.definitions')) {
      return { rows: [definitionRow()] };
    }
    if (sql.includes('FROM configuration.settings')) {
      scopes.push(values[2]);
      if (values[2] === 'COMPANY') {
        return { rows: [settingRow('COMPANY', true, 2)] };
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresConfigurationRepository({ query });
  const resolved = await repository.resolveEffective(
    tenantId,
    'operations.tracking.enabled',
    { type: 'BRANCH', companyId, branchId },
  );

  assert.deepEqual(scopes, ['BRANCH', 'COMPANY']);
  assert.equal(resolved.source, 'COMPANY');
  assert.equal(resolved.companyId, companyId);
  assert.equal(resolved.branchId, null);
});

test('resolver returns definition default when no active override exists', async () => {
  const query = async (sql) => {
    if (sql.includes('FROM configuration.definitions')) {
      return { rows: [definitionRow({ default_value: true })] };
    }
    if (sql.includes('FROM configuration.settings')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresConfigurationRepository({ query });
  const resolved = await repository.resolveEffective(
    tenantId,
    'operations.tracking.enabled',
    { type: 'TENANT' },
  );

  assert.equal(resolved.source, 'DEFINITION_DEFAULT');
  assert.equal(resolved.value, true);
  assert.equal(resolved.settingId, null);
});

test('creating an override appends history in the same repository transaction boundary', async () => {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (sql.includes('FROM configuration.definitions')) {
      return { rows: [definitionRow()] };
    }
    if (sql.includes('FROM configuration.settings')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO configuration.settings')) {
      return { rows: [settingRow('TENANT', true, 1)] };
    }
    if (sql.includes('INSERT INTO configuration.setting_versions')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresConfigurationRepository({ query });
  const result = await repository.putOverride(
    tenantId,
    'operations.tracking.enabled',
    { scope: { type: 'TENANT' }, value: true, reason: 'enable tracking' },
  );

  assert.equal(result.changeType, 'CREATE');
  assert.equal(result.setting.version, '1');
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO configuration.setting_versions')));
});

test('updating an override requires matching optimistic version', async () => {
  const query = async (sql) => {
    if (sql.includes('FROM configuration.definitions')) {
      return { rows: [definitionRow()] };
    }
    if (sql.includes('FROM configuration.settings')) {
      return { rows: [settingRow('TENANT', true, 2)] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresConfigurationRepository({ query });
  await assert.rejects(
    repository.putOverride(
      tenantId,
      'operations.tracking.enabled',
      { scope: { type: 'TENANT' }, value: false, expectedVersion: 1 },
    ),
    { code: 'MVT_CONFIGURATION_VERSION_CONFLICT' },
  );
});
