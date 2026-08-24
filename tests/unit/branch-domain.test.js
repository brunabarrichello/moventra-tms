import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRANCH_STATUS,
  assertBranchTransition,
  assertParentsAllowBranchActivation,
  canTransitionBranchStatus,
  isBranchOperational,
  normalizeBranchCreation,
  normalizeBranchExpectedVersion,
  normalizeBranchTaxIdentifier,
  resolveEffectiveBranchCurrency,
  resolveEffectiveBranchTimezone,
} from '../../src/modules/organization/branch/branch-domain.js';

test('branch creation normalizes company-scoped business values and starts in DRAFT', () => {
  const branch = normalizeBranchCreation({
    code: '  CAMPINAS-SP  ',
    displayName: '  Campinas  ',
    isHeadquarters: true,
    registrationCountry: 'br',
    primaryTaxIdentifierType: 'cnpj',
    primaryTaxIdentifier: '12.345.678/0002-70',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'brl',
  });

  assert.deepEqual(branch, {
    code: 'campinas-sp',
    displayName: 'Campinas',
    isHeadquarters: true,
    registrationCountry: 'BR',
    primaryTaxIdentifierType: 'CNPJ',
    primaryTaxIdentifier: '12345678000270',
    defaultTimezone: 'America/Sao_Paulo',
    defaultCurrency: 'BRL',
    status: BRANCH_STATUS.DRAFT,
  });
});

test('branch creation defaults headquarters false and inherits optional settings', () => {
  const branch = normalizeBranchCreation({
    code: 'porto-alegre',
    displayName: 'Porto Alegre',
  });

  assert.equal(branch.isHeadquarters, false);
  assert.equal(branch.registrationCountry, null);
  assert.equal(branch.primaryTaxIdentifierType, null);
  assert.equal(branch.primaryTaxIdentifier, null);
  assert.equal(branch.defaultTimezone, null);
  assert.equal(branch.defaultCurrency, null);
});

test('branch tax identifier requires country and paired type/value', () => {
  assert.deepEqual(normalizeBranchTaxIdentifier('US', 'ein', '12-3456789'), {
    type: 'EIN',
    value: '123456789',
  });

  assert.throws(
    () => normalizeBranchTaxIdentifier(null, 'CNPJ', '12345678000270'),
    (error) => error.code === 'MVT_BRANCH_TAX_IDENTIFIER_COUNTRY_REQUIRED',
  );

  assert.throws(
    () => normalizeBranchTaxIdentifier('BR', 'CNPJ', null),
    (error) => error.code === 'MVT_BRANCH_TAX_IDENTIFIER_PAIR_INVALID',
  );
});

test('branch lifecycle allows explicit transitions and CLOSED is terminal', () => {
  assert.equal(canTransitionBranchStatus(BRANCH_STATUS.DRAFT, BRANCH_STATUS.ACTIVE), true);
  assert.equal(canTransitionBranchStatus(BRANCH_STATUS.ACTIVE, BRANCH_STATUS.INACTIVE), true);
  assert.equal(canTransitionBranchStatus(BRANCH_STATUS.INACTIVE, BRANCH_STATUS.ACTIVE), true);
  assert.equal(canTransitionBranchStatus(BRANCH_STATUS.ACTIVE, BRANCH_STATUS.CLOSED), true);
  assert.equal(canTransitionBranchStatus(BRANCH_STATUS.CLOSED, BRANCH_STATUS.ACTIVE), false);

  assert.throws(
    () => assertBranchTransition(BRANCH_STATUS.CLOSED, BRANCH_STATUS.ACTIVE),
    (error) => error.code === 'MVT_BRANCH_TRANSITION_INVALID',
  );
});

test('branch activation requires both tenant and company to be operational', () => {
  assert.doesNotThrow(() => assertParentsAllowBranchActivation('ACTIVE', 'ACTIVE'));

  assert.throws(
    () => assertParentsAllowBranchActivation('SUSPENDED', 'ACTIVE'),
    (error) => error.code === 'MVT_BRANCH_TENANT_NOT_OPERATIONAL',
  );

  assert.throws(
    () => assertParentsAllowBranchActivation('ACTIVE', 'INACTIVE'),
    (error) => error.code === 'MVT_BRANCH_COMPANY_NOT_OPERATIONAL',
  );
});

test('only ACTIVE branches are locally operational', () => {
  assert.equal(isBranchOperational(BRANCH_STATUS.ACTIVE), true);
  assert.equal(isBranchOperational(BRANCH_STATUS.DRAFT), false);
  assert.equal(isBranchOperational(BRANCH_STATUS.INACTIVE), false);
  assert.equal(isBranchOperational(BRANCH_STATUS.CLOSED), false);
});

test('branch effective settings follow branch -> company -> tenant inheritance', () => {
  assert.equal(
    resolveEffectiveBranchTimezone('America/Manaus', 'America/Sao_Paulo', 'UTC'),
    'America/Manaus',
  );
  assert.equal(resolveEffectiveBranchTimezone(null, 'America/Sao_Paulo', 'UTC'), 'America/Sao_Paulo');
  assert.equal(resolveEffectiveBranchTimezone(null, null, 'UTC'), 'UTC');

  assert.equal(resolveEffectiveBranchCurrency('USD', 'BRL', 'EUR'), 'USD');
  assert.equal(resolveEffectiveBranchCurrency(null, 'BRL', 'EUR'), 'BRL');
  assert.equal(resolveEffectiveBranchCurrency(null, null, 'EUR'), 'EUR');
});

test('branch expected version is normalized as a positive integer string', () => {
  assert.equal(normalizeBranchExpectedVersion(1), '1');
  assert.equal(normalizeBranchExpectedVersion(42n), '42');
  assert.equal(normalizeBranchExpectedVersion('9007199254740993'), '9007199254740993');
  assert.throws(
    () => normalizeBranchExpectedVersion(0),
    (error) => error.code === 'MVT_BRANCH_VERSION_INVALID',
  );
});
