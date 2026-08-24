import { isTenantOperational } from '../tenant/tenant-domain.js';

export const COMPANY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  CLOSED: 'CLOSED',
});

const companyStatuses = new Set(Object.values(COMPANY_STATUS));
const transitions = new Map([
  [COMPANY_STATUS.DRAFT, new Set([COMPANY_STATUS.ACTIVE, COMPANY_STATUS.CLOSED])],
  [COMPANY_STATUS.ACTIVE, new Set([COMPANY_STATUS.INACTIVE, COMPANY_STATUS.CLOSED])],
  [COMPANY_STATUS.INACTIVE, new Set([COMPANY_STATUS.ACTIVE, COMPANY_STATUS.CLOSED])],
  [COMPANY_STATUS.CLOSED, new Set()],
]);

const companyCodePattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const countryPattern = /^[A-Z]{2}$/;
const currencyPattern = /^[A-Z]{3}$/;
const taxTypePattern = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;
const taxValuePattern = /^[A-Z0-9]{2,64}$/;

export function normalizeCompanyCreation(input) {
  assertRecord(input, 'Company creation input');
  const taxIdentifier = normalizePrimaryTaxIdentifier(
    input.primaryTaxIdentifierType,
    input.primaryTaxIdentifier,
  );

  return {
    code: normalizeCompanyCode(input.code),
    legalName: normalizeLegalName(input.legalName),
    displayName: normalizeOptionalDisplayName(input.displayName),
    registrationCountry: normalizeRegistrationCountry(input.registrationCountry),
    primaryTaxIdentifierType: taxIdentifier.type,
    primaryTaxIdentifier: taxIdentifier.value,
    defaultTimezone: normalizeOptionalTimezone(input.defaultTimezone),
    defaultCurrency: normalizeOptionalCurrency(input.defaultCurrency),
    status: COMPANY_STATUS.DRAFT,
  };
}

export function normalizeCompanyProfileUpdate(input) {
  assertRecord(input, 'Company profile update input');
  const taxIdentifier = normalizePrimaryTaxIdentifier(
    input.primaryTaxIdentifierType,
    input.primaryTaxIdentifier,
  );

  return {
    legalName: normalizeLegalName(input.legalName),
    displayName: normalizeOptionalDisplayName(input.displayName),
    registrationCountry: normalizeRegistrationCountry(input.registrationCountry),
    primaryTaxIdentifierType: taxIdentifier.type,
    primaryTaxIdentifier: taxIdentifier.value,
    defaultTimezone: normalizeOptionalTimezone(input.defaultTimezone),
    defaultCurrency: normalizeOptionalCurrency(input.defaultCurrency),
  };
}

export function normalizeCompanyCode(value) {
  const code = requireString(value, 'Company code').toLowerCase();

  if (!companyCodePattern.test(code)) {
    throw companyDomainError(
      'MVT_COMPANY_CODE_INVALID',
      'Company code must contain 3-63 lowercase letters, digits or internal hyphens',
    );
  }

  return code;
}

export function normalizeLegalName(value) {
  const legalName = requireString(value, 'Company legal name');

  if (legalName.length < 2 || legalName.length > 200) {
    throw companyDomainError(
      'MVT_COMPANY_LEGAL_NAME_INVALID',
      'Company legal name must contain between 2 and 200 characters',
    );
  }

  return legalName;
}

export function normalizeOptionalDisplayName(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw companyDomainError(
      'MVT_COMPANY_DISPLAY_NAME_INVALID',
      'Company display name must be a string when provided',
    );
  }

  const displayName = value.trim();

  if (displayName.length < 2 || displayName.length > 160) {
    throw companyDomainError(
      'MVT_COMPANY_DISPLAY_NAME_INVALID',
      'Company display name must contain between 2 and 160 characters',
    );
  }

  return displayName;
}

export function normalizeRegistrationCountry(value) {
  const country = requireString(value, 'Company registration country').toUpperCase();

  if (!countryPattern.test(country)) {
    throw companyDomainError(
      'MVT_COMPANY_COUNTRY_INVALID',
      'Company registration country must be a two-letter ISO 3166-1 alpha-2 code',
    );
  }

  return country;
}

export function normalizePrimaryTaxIdentifier(typeValue, identifierValue) {
  const typeMissing = typeValue === null || typeValue === undefined || typeValue === '';
  const identifierMissing =
    identifierValue === null || identifierValue === undefined || identifierValue === '';

  if (typeMissing && identifierMissing) {
    return { type: null, value: null };
  }

  if (typeMissing || identifierMissing) {
    throw companyDomainError(
      'MVT_COMPANY_TAX_IDENTIFIER_PAIR_INVALID',
      'Company tax identifier type and value must be provided together',
    );
  }

  const type = requireString(typeValue, 'Company tax identifier type').toUpperCase();
  const value = requireString(identifierValue, 'Company tax identifier')
    .toUpperCase()
    .replace(/[\s.\-/]/g, '');

  if (!taxTypePattern.test(type)) {
    throw companyDomainError(
      'MVT_COMPANY_TAX_IDENTIFIER_TYPE_INVALID',
      'Company tax identifier type must contain 2-32 uppercase letters, digits, dot, underscore or hyphen',
    );
  }

  if (!taxValuePattern.test(value)) {
    throw companyDomainError(
      'MVT_COMPANY_TAX_IDENTIFIER_INVALID',
      'Company tax identifier must normalize to 2-64 uppercase alphanumeric characters',
    );
  }

  return { type, value };
}

export function normalizeOptionalTimezone(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw companyDomainError(
      'MVT_COMPANY_TIMEZONE_INVALID',
      'Company default timezone must be a string when provided',
    );
  }

  const timezone = value.trim();

  if (!timezone || timezone.length > 100) {
    throw companyDomainError(
      'MVT_COMPANY_TIMEZONE_INVALID',
      'Company default timezone is invalid',
    );
  }

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw companyDomainError(
      'MVT_COMPANY_TIMEZONE_INVALID',
      'Company default timezone must be a valid IANA timezone identifier',
    );
  }
}

export function normalizeOptionalCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw companyDomainError(
      'MVT_COMPANY_CURRENCY_INVALID',
      'Company default currency must be a string when provided',
    );
  }

  const currency = value.trim().toUpperCase();

  if (!currencyPattern.test(currency)) {
    throw companyDomainError(
      'MVT_COMPANY_CURRENCY_INVALID',
      'Company default currency must be a three-letter ISO 4217 code',
    );
  }

  return currency;
}

export function assertCompanyStatus(value) {
  if (!companyStatuses.has(value)) {
    throw companyDomainError('MVT_COMPANY_STATUS_INVALID', `Unknown company status: ${value}`);
  }

  return value;
}

export function canTransitionCompanyStatus(fromStatus, toStatus) {
  assertCompanyStatus(fromStatus);
  assertCompanyStatus(toStatus);
  return transitions.get(fromStatus).has(toStatus);
}

export function assertCompanyTransition(fromStatus, toStatus) {
  if (!canTransitionCompanyStatus(fromStatus, toStatus)) {
    throw companyDomainError(
      'MVT_COMPANY_TRANSITION_INVALID',
      `Company status transition ${fromStatus} -> ${toStatus} is not allowed`,
    );
  }
}

export function assertTenantAllowsCompanyActivation(tenantStatus) {
  if (!isTenantOperational(tenantStatus)) {
    throw companyDomainError(
      'MVT_COMPANY_TENANT_NOT_OPERATIONAL',
      'Company cannot become ACTIVE unless its tenant is operational',
    );
  }
}

export function isCompanyOperational(status) {
  assertCompanyStatus(status);
  return status === COMPANY_STATUS.ACTIVE;
}

export function normalizeCompanyExpectedVersion(value) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw companyDomainError(
      'MVT_COMPANY_VERSION_INVALID',
      'Company expected version must be a positive integer',
    );
  }

  return normalized;
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw companyDomainError('MVT_COMPANY_INPUT_INVALID', `${label} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw companyDomainError('MVT_COMPANY_INPUT_INVALID', `${label} is required`);
  }

  return normalized;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw companyDomainError('MVT_COMPANY_INPUT_INVALID', `${label} must be an object`);
  }
}

function companyDomainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
