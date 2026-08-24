import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPANY_STATUS,
  assertCompanyTransition,
  assertTenantAllowsCompanyActivation,
  canTransitionCompanyStatus,
  isCompanyOperational,
  normalizeCompanyCreation,
  normalizeCompanyExpectedVersion,
  normalizePrimaryTaxIdentifier,
  normalizeRegistrationCountry,
} from '../../src/modules/organization/company/company-domain.js';

test('company creation normalizes tenant-scoped business values and starts in DRAFT', () => {
  const company = normalizeCompanyCreation({
    code: '  MATRIZ-BR  ',
    legalName: '  ACME Logística S.A.  ',
    displayName: '  ACME Logística  ',
    registrationCountry: 'br',
    primaryTaxIdentifierType: 'cnpj',
    primaryTaxIdentifier: '12.345.678/0001-90',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'brl',
  });

  assert.deepEqual(company, {
    code: 'matriz-br',
    legalName: 'ACME Logística S.A.',
    displayName: 'ACME Logística',
    registrationCountry: 'BR',
    primaryTaxIdentifierType: 'CNPJ',
    primaryTaxIdentifier: '12345678000190',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'BRL',
    status: COMPANY_STATUS.DRAFT,
  });
});

test('company creation supports inherited tenant timezone and currency', () => {
  const company = normalizeCompanyCreation({
    code: 'acme-us',
    legalName: 'ACME Logistics Inc.',
    registrationCountry: 'US',
  });

  assert.equal(company.displayName, null);
  assert.equal(company.primaryTaxIdentifierType, null);
  assert.equal(company.primaryTaxIdentifier, null);
  assert.equal(company.defaultTimezone, null);
  assert.equal(company.defaultCurrency, null);
});

test('company code rejects unsafe or unstable shapes', () => {
  assert.throws(
    () =>
      normalizeCompanyCreation({
        code: '-bad-',
        legalName: 'Bad Company',
        registrationCountry: 'BR',
      }),
    (error) => error.code === 'MVT_COMPANY_CODE_INVALID',
  );
});

test('registration country requires an ISO alpha-2 shaped code', () => {
  assert.equal(normalizeRegistrationCountry('br'), 'BR');
  assert.throws(
    () => normalizeRegistrationCountry('BRA'),
    (error) => error.code === 'MVT_COMPANY_COUNTRY_INVALID',
  );
});

test('tax identifier type and value are paired and normalized without Brazil-only coupling', () => {
  assert.deepEqual(normalizePrimaryTaxIdentifier('ein', '12-3456789'), {
    type: 'EIN',
    value: '123456789',
  });
  assert.deepEqual(normalizePrimaryTaxIdentifier(null, null), { type: null, value: null });

  assert.throws(
    () => normalizePrimaryTaxIdentifier('CNPJ', null),
    (error) => error.code === 'MVT_COMPANY_TAX_IDENTIFIER_PAIR_INVALID',
  );
});

test('company lifecycle allows only explicit transitions and CLOSED is terminal', () => {
  assert.equal(canTransitionCompanyStatus(COMPANY_STATUS.DRAFT, COMPANY_STATUS.ACTIVE), true);
  assert.equal(canTransitionCompanyStatus(COMPANY_STATUS.ACTIVE, COMPANY_STATUS.INACTIVE), true);
  assert.equal(canTransitionCompanyStatus(COMPANY_STATUS.INACTIVE, COMPANY_STATUS.ACTIVE), true);
  assert.equal(canTransitionCompanyStatus(COMPANY_STATUS.ACTIVE, COMPANY_STATUS.CLOSED), true);
  assert.equal(canTransitionCompanyStatus(COMPANY_STATUS.CLOSED, COMPANY_STATUS.ACTIVE), false);

  assert.throws(
    () => assertCompanyTransition(COMPANY_STATUS.CLOSED, COMPANY_STATUS.ACTIVE),
    (error) => error.code === 'MVT_COMPANY_TRANSITION_INVALID',
  );
});

test('company activation requires an operational parent tenant', () => {
  assert.doesNotThrow(() => assertTenantAllowsCompanyActivation('ACTIVE'));
  assert.throws(
    () => assertTenantAllowsCompanyActivation('SUSPENDED'),
    (error) => error.code === 'MVT_COMPANY_TENANT_NOT_OPERATIONAL',
  );
  assert.throws(
    () => assertTenantAllowsCompanyActivation('CLOSED'),
    (error) => error.code === 'MVT_COMPANY_TENANT_NOT_OPERATIONAL',
  );
});

test('only ACTIVE companies are operational in the initial lifecycle contract', () => {
  assert.equal(isCompanyOperational(COMPANY_STATUS.ACTIVE), true);
  assert.equal(isCompanyOperational(COMPANY_STATUS.DRAFT), false);
  assert.equal(isCompanyOperational(COMPANY_STATUS.INACTIVE), false);
  assert.equal(isCompanyOperational(COMPANY_STATUS.CLOSED), false);
});

test('company expected version is normalized as a positive integer string', () => {
  assert.equal(normalizeCompanyExpectedVersion(1), '1');
  assert.equal(normalizeCompanyExpectedVersion(42n), '42');
  assert.equal(normalizeCompanyExpectedVersion('9007199254740993'), '9007199254740993');
  assert.throws(
    () => normalizeCompanyExpectedVersion(0),
    (error) => error.code === 'MVT_COMPANY_VERSION_INVALID',
  );
});
