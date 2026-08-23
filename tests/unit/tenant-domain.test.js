import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TENANT_STATUS,
  assertTenantTransition,
  canTransitionTenantStatus,
  isTenantOperational,
  normalizeCurrency,
  normalizeExpectedVersion,
  normalizeTenantCreation,
  normalizeTimezone,
} from '../../src/modules/organization/tenant/tenant-domain.js';

test('tenant creation normalizes stable business values and starts provisioning', () => {
  const tenant = normalizeTenantCreation({
    code: '  ACME-LOG  ',
    displayName: '  ACME Logística  ',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'brl',
  });

  assert.deepEqual(tenant, {
    code: 'acme-log',
    displayName: 'ACME Logística',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'BRL',
    status: TENANT_STATUS.PROVISIONING,
  });
});

test('tenant code rejects unsafe or unstable shapes', () => {
  assert.throws(
    () =>
      normalizeTenantCreation({
        code: '-bad-',
        displayName: 'Bad Tenant',
        defaultTimezone: 'UTC',
        defaultCurrency: 'BRL',
      }),
    (error) => error.code === 'MVT_TENANT_CODE_INVALID',
  );
});

test('timezone validation accepts IANA identifiers and rejects invalid zones', () => {
  assert.equal(normalizeTimezone('America/Sao_Paulo'), 'America/Sao_Paulo');
  assert.throws(
    () => normalizeTimezone('Mars/Olympus_Mons'),
    (error) => error.code === 'MVT_TENANT_TIMEZONE_INVALID',
  );
});

test('currency normalization requires a three-letter code', () => {
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.throws(
    () => normalizeCurrency('R$'),
    (error) => error.code === 'MVT_TENANT_CURRENCY_INVALID',
  );
});

test('tenant lifecycle allows only explicit transitions', () => {
  assert.equal(canTransitionTenantStatus(TENANT_STATUS.PROVISIONING, TENANT_STATUS.ACTIVE), true);
  assert.equal(canTransitionTenantStatus(TENANT_STATUS.ACTIVE, TENANT_STATUS.SUSPENDED), true);
  assert.equal(canTransitionTenantStatus(TENANT_STATUS.SUSPENDED, TENANT_STATUS.ACTIVE), true);
  assert.equal(canTransitionTenantStatus(TENANT_STATUS.CLOSING, TENANT_STATUS.ACTIVE), true);
  assert.equal(canTransitionTenantStatus(TENANT_STATUS.CLOSING, TENANT_STATUS.CLOSED), true);

  assert.equal(canTransitionTenantStatus(TENANT_STATUS.CLOSED, TENANT_STATUS.ACTIVE), false);
  assert.throws(
    () => assertTenantTransition(TENANT_STATUS.CLOSED, TENANT_STATUS.ACTIVE),
    (error) => error.code === 'MVT_TENANT_TRANSITION_INVALID',
  );
});

test('only ACTIVE tenants are operational in the initial lifecycle contract', () => {
  assert.equal(isTenantOperational(TENANT_STATUS.ACTIVE), true);
  assert.equal(isTenantOperational(TENANT_STATUS.PROVISIONING), false);
  assert.equal(isTenantOperational(TENANT_STATUS.SUSPENDED), false);
  assert.equal(isTenantOperational(TENANT_STATUS.CLOSING), false);
  assert.equal(isTenantOperational(TENANT_STATUS.CLOSED), false);
});

test('expected version is normalized as a positive integer string', () => {
  assert.equal(normalizeExpectedVersion(1), '1');
  assert.equal(normalizeExpectedVersion(42n), '42');
  assert.equal(normalizeExpectedVersion('9007199254740993'), '9007199254740993');
  assert.throws(
    () => normalizeExpectedVersion(0),
    (error) => error.code === 'MVT_TENANT_VERSION_INVALID',
  );
});
