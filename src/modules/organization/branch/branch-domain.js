import { isCompanyOperational } from '../company/company-domain.js';
import { isTenantOperational } from '../tenant/tenant-domain.js';

export const BRANCH_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  CLOSED: 'CLOSED',
});

const branchStatuses = new Set(Object.values(BRANCH_STATUS));
const transitions = new Map([
  [BRANCH_STATUS.DRAFT, new Set([BRANCH_STATUS.ACTIVE, BRANCH_STATUS.CLOSED])],
  [BRANCH_STATUS.ACTIVE, new Set([BRANCH_STATUS.INACTIVE, BRANCH_STATUS.CLOSED])],
  [BRANCH_STATUS.INACTIVE, new Set([BRANCH_STATUS.ACTIVE, BRANCH_STATUS.CLOSED])],
  [BRANCH_STATUS.CLOSED, new Set()],
]);

const branchCodePattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const countryPattern = /^[A-Z]{2}$/;
const currencyPattern = /^[A-Z]{3}$/;
const taxTypePattern = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;
const taxValuePattern = /^[A-Z0-9]{2,64}$/;

export function normalizeBranchCreation(input) {
  assertRecord(input, 'Branch creation input');
  const registrationCountry = normalizeOptionalRegistrationCountry(input.registrationCountry);
  const taxIdentifier = normalizeBranchTaxIdentifier(
    registrationCountry,
    input.primaryTaxIdentifierType,
    input.primaryTaxIdentifier,
  );

  return {
    code: normalizeBranchCode(input.code),
    displayName: normalizeBranchDisplayName(input.displayName),
    isHeadquarters: normalizeBranchHeadquarters(input.isHeadquarters, true),
    registrationCountry,
    primaryTaxIdentifierType: taxIdentifier.type,
    primaryTaxIdentifier: taxIdentifier.value,
    defaultTimezone: normalizeBranchOptionalTimezone(input.defaultTimezone),
    defaultCurrency: normalizeBranchOptionalCurrency(input.defaultCurrency),
    status: BRANCH_STATUS.DRAFT,
  };
}

export function normalizeBranchProfileUpdate(input) {
  assertRecord(input, 'Branch profile update input');
  const registrationCountry = normalizeOptionalRegistrationCountry(input.registrationCountry);
  const taxIdentifier = normalizeBranchTaxIdentifier(
    registrationCountry,
    input.primaryTaxIdentifierType,
    input.primaryTaxIdentifier,
  );

  return {
    displayName: normalizeBranchDisplayName(input.displayName),
    isHeadquarters: normalizeBranchHeadquarters(input.isHeadquarters, false),
    registrationCountry,
    primaryTaxIdentifierType: taxIdentifier.type,
    primaryTaxIdentifier: taxIdentifier.value,
    defaultTimezone: normalizeBranchOptionalTimezone(input.defaultTimezone),
    defaultCurrency: normalizeBranchOptionalCurrency(input.defaultCurrency),
  };
}

export function normalizeBranchCode(value) {
  const code = requireString(value, 'Branch code').toLowerCase();

  if (!branchCodePattern.test(code)) {
    throw branchDomainError(
      'MVT_BRANCH_CODE_INVALID',
      'Branch code must contain 3-63 lowercase letters, digits or internal hyphens',
    );
  }

  return code;
}

export function normalizeBranchDisplayName(value) {
  const displayName = requireString(value, 'Branch display name');

  if (displayName.length < 2 || displayName.length > 160) {
    throw branchDomainError(
      'MVT_BRANCH_DISPLAY_NAME_INVALID',
      'Branch display name must contain between 2 and 160 characters',
    );
  }

  return displayName;
}

export function normalizeBranchHeadquarters(value, defaultWhenMissing = false) {
  if (value === undefined || value === null) {
    if (defaultWhenMissing) {
      return false;
    }

    throw branchDomainError(
      'MVT_BRANCH_HEADQUARTERS_INVALID',
      'Branch headquarters flag must be explicitly provided for profile updates',
    );
  }

  if (typeof value !== 'boolean') {
    throw branchDomainError(
      'MVT_BRANCH_HEADQUARTERS_INVALID',
      'Branch headquarters flag must be a boolean',
    );
  }

  return value;
}

export function normalizeOptionalRegistrationCountry(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw branchDomainError(
      'MVT_BRANCH_COUNTRY_INVALID',
      'Branch registration country must be a string when provided',
    );
  }

  const country = value.trim().toUpperCase();

  if (!countryPattern.test(country)) {
    throw branchDomainError(
      'MVT_BRANCH_COUNTRY_INVALID',
      'Branch registration country must be a two-letter ISO 3166-1 alpha-2 code',
    );
  }

  return country;
}

export function normalizeBranchTaxIdentifier(registrationCountry, typeValue, identifierValue) {
  const typeMissing = typeValue === null || typeValue === undefined || typeValue === '';
  const identifierMissing =
    identifierValue === null || identifierValue === undefined || identifierValue === '';

  if (typeMissing && identifierMissing) {
    return { type: null, value: null };
  }

  if (typeMissing || identifierMissing) {
    throw branchDomainError(
      'MVT_BRANCH_TAX_IDENTIFIER_PAIR_INVALID',
      'Branch tax identifier type and value must be provided together',
    );
  }

  if (!registrationCountry) {
    throw branchDomainError(
      'MVT_BRANCH_TAX_IDENTIFIER_COUNTRY_REQUIRED',
      'Branch registration country is required when a tax identifier is provided',
    );
  }

  const type = requireString(typeValue, 'Branch tax identifier type').toUpperCase();
  const value = requireString(identifierValue, 'Branch tax identifier')
    .toUpperCase()
    .replace(/[\s.\-/]/g, '');

  if (!taxTypePattern.test(type)) {
    throw branchDomainError(
      'MVT_BRANCH_TAX_IDENTIFIER_TYPE_INVALID',
      'Branch tax identifier type must contain 2-32 uppercase letters, digits, dot, underscore or hyphen',
    );
  }

  if (!taxValuePattern.test(value)) {
    throw branchDomainError(
      'MVT_BRANCH_TAX_IDENTIFIER_INVALID',
      'Branch tax identifier must normalize to 2-64 uppercase alphanumeric characters',
    );
  }

  return { type, value };
}

export function normalizeBranchOptionalTimezone(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw branchDomainError(
      'MVT_BRANCH_TIMEZONE_INVALID',
      'Branch default timezone must be a string when provided',
    );
  }

  const timezone = value.trim();

  if (!timezone || timezone.length > 100) {
    throw branchDomainError('MVT_BRANCH_TIMEZONE_INVALID', 'Branch default timezone is invalid');
  }

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw branchDomainError(
      'MVT_BRANCH_TIMEZONE_INVALID',
      'Branch default timezone must be a valid IANA timezone identifier',
    );
  }
}

export function normalizeBranchOptionalCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw branchDomainError(
      'MVT_BRANCH_CURRENCY_INVALID',
      'Branch default currency must be a string when provided',
    );
  }

  const currency = value.trim().toUpperCase();

  if (!currencyPattern.test(currency)) {
    throw branchDomainError(
      'MVT_BRANCH_CURRENCY_INVALID',
      'Branch default currency must be a three-letter ISO 4217 code',
    );
  }

  return currency;
}

export function assertBranchStatus(value) {
  if (!branchStatuses.has(value)) {
    throw branchDomainError('MVT_BRANCH_STATUS_INVALID', `Unknown branch status: ${value}`);
  }

  return value;
}

export function canTransitionBranchStatus(fromStatus, toStatus) {
  assertBranchStatus(fromStatus);
  assertBranchStatus(toStatus);
  return transitions.get(fromStatus).has(toStatus);
}

export function assertBranchTransition(fromStatus, toStatus) {
  if (!canTransitionBranchStatus(fromStatus, toStatus)) {
    throw branchDomainError(
      'MVT_BRANCH_TRANSITION_INVALID',
      `Branch status transition ${fromStatus} -> ${toStatus} is not allowed`,
    );
  }
}

export function assertParentsAllowBranchActivation(tenantStatus, companyStatus) {
  if (!isTenantOperational(tenantStatus)) {
    throw branchDomainError(
      'MVT_BRANCH_TENANT_NOT_OPERATIONAL',
      'Branch cannot become ACTIVE unless its tenant is operational',
    );
  }

  if (!isCompanyOperational(companyStatus)) {
    throw branchDomainError(
      'MVT_BRANCH_COMPANY_NOT_OPERATIONAL',
      'Branch cannot become ACTIVE unless its company is operational',
    );
  }
}

export function isBranchOperational(status) {
  assertBranchStatus(status);
  return status === BRANCH_STATUS.ACTIVE;
}

export function resolveEffectiveBranchTimezone(branchTimezone, companyTimezone, tenantTimezone) {
  return branchTimezone ?? companyTimezone ?? tenantTimezone;
}

export function resolveEffectiveBranchCurrency(branchCurrency, companyCurrency, tenantCurrency) {
  return branchCurrency ?? companyCurrency ?? tenantCurrency;
}

export function normalizeBranchExpectedVersion(value) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw branchDomainError(
      'MVT_BRANCH_VERSION_INVALID',
      'Branch expected version must be a positive integer',
    );
  }

  return normalized;
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw branchDomainError('MVT_BRANCH_INPUT_INVALID', `${label} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw branchDomainError('MVT_BRANCH_INPUT_INVALID', `${label} is required`);
  }

  return normalized;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw branchDomainError('MVT_BRANCH_INPUT_INVALID', `${label} must be an object`);
  }
}

function branchDomainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
