import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresTenantRepository } from '../../src/modules/organization/tenant/tenant-repository.js';

const tenantId = '0198f1c0-1234-7abc-8def-0123456789ab';
const createdAt = new Date('2026-08-23T20:00:00.000Z');
const updatedAt = new Date('2026-08-23T20:00:00.000Z');

function tenantRow(overrides = {}) {
  return {
    id: tenantId,
    code: 'acme-log',
    display_name: 'ACME Logística',
    status: 'PROVISIONING',
    default_timezone: 'America/Sao_Paulo',
    default_currency: 'BRL',
    created_at: createdAt,
    updated_at: updatedAt,
    version: '1',
    ...overrides,
  };
}

test('tenant repository creates a normalized provisioning tenant', async () => {
  const calls = [];
  const repository = new PostgresTenantRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [tenantRow()] };
    },
  });

  const tenant = await repository.create({
    code: ' ACME-LOG ',
    displayName: ' ACME Logística ',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'brl',
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO organization\.tenants/);
  assert.deepEqual(calls[0].values, [
    'acme-log',
    'ACME Logística',
    'PROVISIONING',
    'America/Sao_Paulo',
    'BRL',
  ]);
  assert.equal(tenant.id, tenantId);
  assert.equal(tenant.version, '1');
});

test('tenant repository maps unique code violation to a domain-safe conflict', async () => {
  const repository = new PostgresTenantRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_tenants_code';
      throw error;
    },
  });

  await assert.rejects(
    () =>
      repository.create({
        code: 'acme-log',
        displayName: 'ACME Logística',
        defaultTimezone: 'America/Sao_Paulo',
        defaultCurrency: 'BRL',
      }),
    (error) => error.code === 'MVT_TENANT_CODE_CONFLICT',
  );
});

test('profile update increments version and detects optimistic-lock conflict', async () => {
  const calls = [];
  const repository = new PostgresTenantRepository({
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
        {
          displayName: 'ACME Transportes',
          defaultTimezone: 'America/Sao_Paulo',
          defaultCurrency: 'BRL',
        },
        '1',
      ),
    (error) => error.code === 'MVT_TENANT_VERSION_CONFLICT',
  );

  assert.match(calls[0].text, /version = version \+ 1/);
  assert.equal(calls[0].values.at(-1), '1');
});

test('status transition uses current state and expected version in the atomic update', async () => {
  const calls = [];
  const repository = new PostgresTenantRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.startsWith('SELECT')) {
        return { rows: [tenantRow({ status: 'ACTIVE', version: '3' })] };
      }

      return { rows: [tenantRow({ status: 'SUSPENDED', version: '4' })] };
    },
  });

  const tenant = await repository.transitionStatus(tenantId, 'SUSPENDED', '3');

  assert.equal(tenant.status, 'SUSPENDED');
  assert.equal(tenant.version, '4');
  assert.match(calls[1].text, /AND status = \$3/);
  assert.match(calls[1].text, /AND version = \$4/);
  assert.deepEqual(calls[1].values, [tenantId, 'SUSPENDED', 'ACTIVE', '3']);
});

test('terminal CLOSED status cannot transition back to ACTIVE', async () => {
  const repository = new PostgresTenantRepository({
    query: async () => ({ rows: [tenantRow({ status: 'CLOSED', version: '7' })] }),
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, 'ACTIVE', '7'),
    (error) => error.code === 'MVT_TENANT_TRANSITION_INVALID',
  );
});
