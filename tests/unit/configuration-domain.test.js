import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertConfigurationScopeAllowed,
  normalizeConfigurationExpectedVersion,
  normalizeConfigurationKey,
  normalizeConfigurationScope,
  normalizeConfigurationValue,
  scopeFromConfigurationContext,
} from '../../src/modules/configuration/configuration-domain.js';

function definition(overrides = {}) {
  return {
    valueType: 'BOOLEAN',
    validationSchema: {},
    allowTenantOverride: true,
    allowCompanyOverride: true,
    allowBranchOverride: true,
    sensitivity: 'INTERNAL',
    ...overrides,
  };
}

test('configuration key is canonical and rejects secret-bearing namespaces', () => {
  assert.equal(
    normalizeConfigurationKey(' Operations.Tracking_ETA.Enabled '),
    'operations.tracking_eta.enabled',
  );
  assert.throws(
    () => normalizeConfigurationKey('integrations.api_key.primary'),
    { code: 'MVT_CONFIGURATION_SECRET_FORBIDDEN' },
  );
});

test('configuration scopes encode Tenant, Company and Branch hierarchy', () => {
  const companyId = '01990180-0000-7000-8000-000000000011';
  const branchId = '01990180-0000-7000-8000-000000000021';

  assert.deepEqual(normalizeConfigurationScope({ type: 'TENANT' }), {
    type: 'TENANT', companyId: null, branchId: null,
  });
  assert.deepEqual(scopeFromConfigurationContext({ companyId }), {
    type: 'COMPANY', companyId, branchId: null,
  });
  assert.deepEqual(scopeFromConfigurationContext({ companyId, branchId }), {
    type: 'BRANCH', companyId, branchId,
  });
  assert.throws(
    () => normalizeConfigurationScope({ type: 'BRANCH', branchId }),
    { code: 'MVT_CONFIGURATION_SCOPE_INVALID' },
  );
});

test('definition controls which organizational scopes may override', () => {
  const companyId = '01990180-0000-7000-8000-000000000011';
  assert.throws(
    () => assertConfigurationScopeAllowed(
      definition({ allowCompanyOverride: false }),
      { type: 'COMPANY', companyId },
    ),
    { code: 'MVT_CONFIGURATION_SCOPE_NOT_ALLOWED' },
  );
});

test('typed values validate boolean, integer and exact decimal contracts', () => {
  assert.equal(normalizeConfigurationValue(definition(), true), true);
  assert.equal(
    normalizeConfigurationValue(definition({ valueType: 'INTEGER', validationSchema: { minimum: 1, maximum: 10 } }), 5),
    5,
  );
  assert.equal(
    normalizeConfigurationValue(definition({ valueType: 'DECIMAL' }), '123.4500'),
    '123.4500',
  );
  assert.throws(
    () => normalizeConfigurationValue(definition({ valueType: 'DECIMAL' }), 123.45),
    { code: 'MVT_CONFIGURATION_VALUE_INVALID' },
  );
});

test('enum, timezone and currency values are validated by logical type', () => {
  assert.equal(
    normalizeConfigurationValue(
      definition({ valueType: 'ENUM', validationSchema: { allowedValues: ['FAST', 'SAFE'] } }),
      'SAFE',
    ),
    'SAFE',
  );
  assert.throws(
    () => normalizeConfigurationValue(
      definition({ valueType: 'ENUM', validationSchema: { allowedValues: ['FAST', 'SAFE'] } }),
      'OTHER',
    ),
    { code: 'MVT_CONFIGURATION_VALUE_INVALID' },
  );
  assert.equal(
    normalizeConfigurationValue(definition({ valueType: 'TIMEZONE' }), 'America/Sao_Paulo'),
    'America/Sao_Paulo',
  );
  assert.equal(normalizeConfigurationValue(definition({ valueType: 'CURRENCY' }), 'brl'), 'BRL');
});

test('JSON values enforce configured size and depth limits', () => {
  assert.deepEqual(
    normalizeConfigurationValue(
      definition({ valueType: 'JSON', validationSchema: { maxDepth: 3, maxBytes: 1000 } }),
      { nested: { enabled: true } },
    ),
    { nested: { enabled: true } },
  );
  assert.throws(
    () => normalizeConfigurationValue(
      definition({ valueType: 'JSON', validationSchema: { maxDepth: 2 } }),
      { one: { two: { three: true } } },
    ),
    { code: 'MVT_CONFIGURATION_VALUE_INVALID' },
  );
});

test('optimistic version contract rejects zero and non-integers', () => {
  assert.equal(normalizeConfigurationExpectedVersion(3), '3');
  assert.equal(normalizeConfigurationExpectedVersion('42'), '42');
  assert.throws(
    () => normalizeConfigurationExpectedVersion(0),
    { code: 'MVT_CONFIGURATION_VERSION_INVALID' },
  );
});
