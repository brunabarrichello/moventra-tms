export const TENANT_STATUS = Object.freeze({
  PROVISIONING: 'PROVISIONING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
});

const tenantStatuses = new Set(Object.values(TENANT_STATUS));
const transitions = new Map([
  [TENANT_STATUS.PROVISIONING, new Set([TENANT_STATUS.ACTIVE, TENANT_STATUS.CLOSING])],
  [TENANT_STATUS.ACTIVE, new Set([TENANT_STATUS.SUSPENDED, TENANT_STATUS.CLOSING])],
  [TENANT_STATUS.SUSPENDED, new Set([TENANT_STATUS.ACTIVE, TENANT_STATUS.CLOSING])],
  [TENANT_STATUS.CLOSING, new Set([TENANT_STATUS.ACTIVE, TENANT_STATUS.CLOSED])],
  [TENANT_STATUS.CLOSED, new Set()],
]);

const tenantCodePattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const currencyPattern = /^[A-Z]{3}$/;

export function normalizeTenantCreation(input) {
  assertRecord(input, 'Tenant creation input');

  return {
    code: normalizeTenantCode(input.code),
    displayName: normalizeDisplayName(input.displayName),
    defaultTimezone: normalizeTimezone(input.defaultTimezone),
    defaultCurrency: normalizeCurrency(input.defaultCurrency),
    status: TENANT_STATUS.PROVISIONING,
  };
}

export function normalizeTenantProfileUpdate(input) {
  assertRecord(input, 'Tenant profile update input');

  return {
    displayName: normalizeDisplayName(input.displayName),
    defaultTimezone: normalizeTimezone(input.defaultTimezone),
    defaultCurrency: normalizeCurrency(input.defaultCurrency),
  };
}

export function normalizeTenantCode(value) {
  const code = requireString(value, 'Tenant code').toLowerCase();

  if (!tenantCodePattern.test(code)) {
    throw tenantDomainError(
      'MVT_TENANT_CODE_INVALID',
      'Tenant code must contain 3-63 lowercase letters, digits or internal hyphens',
    );
  }

  return code;
}

export function normalizeDisplayName(value) {
  const displayName = requireString(value, 'Tenant display name');

  if (displayName.length < 2 || displayName.length > 160) {
    throw tenantDomainError(
      'MVT_TENANT_NAME_INVALID',
      'Tenant display name must contain between 2 and 160 characters',
    );
  }

  return displayName;
}

export function normalizeTimezone(value) {
  const timezone = requireString(value, 'Tenant default timezone');

  if (timezone.length > 100) {
    throw tenantDomainError(
      'MVT_TENANT_TIMEZONE_INVALID',
      'Tenant default timezone is too long',
    );
  }

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw tenantDomainError(
      'MVT_TENANT_TIMEZONE_INVALID',
      'Tenant default timezone must be a valid IANA timezone identifier',
    );
  }
}

export function normalizeCurrency(value) {
  const currency = requireString(value, 'Tenant default currency').toUpperCase();

  if (!currencyPattern.test(currency)) {
    throw tenantDomainError(
      'MVT_TENANT_CURRENCY_INVALID',
      'Tenant default currency must be a three-letter ISO 4217 code',
    );
  }

  return currency;
}

export function assertTenantStatus(value) {
  if (!tenantStatuses.has(value)) {
    throw tenantDomainError('MVT_TENANT_STATUS_INVALID', `Unknown tenant status: ${value}`);
  }

  return value;
}

export function canTransitionTenantStatus(fromStatus, toStatus) {
  assertTenantStatus(fromStatus);
  assertTenantStatus(toStatus);
  return transitions.get(fromStatus).has(toStatus);
}

export function assertTenantTransition(fromStatus, toStatus) {
  if (!canTransitionTenantStatus(fromStatus, toStatus)) {
    throw tenantDomainError(
      'MVT_TENANT_TRANSITION_INVALID',
      `Tenant status transition ${fromStatus} -> ${toStatus} is not allowed`,
    );
  }
}

export function isTenantOperational(status) {
  assertTenantStatus(status);
  return status === TENANT_STATUS.ACTIVE;
}

export function normalizeExpectedVersion(value) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw tenantDomainError(
      'MVT_TENANT_VERSION_INVALID',
      'Tenant expected version must be a positive integer',
    );
  }

  return normalized;
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw tenantDomainError('MVT_TENANT_INPUT_INVALID', `${label} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw tenantDomainError('MVT_TENANT_INPUT_INVALID', `${label} is required`);
  }

  return normalized;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw tenantDomainError('MVT_TENANT_INPUT_INVALID', `${label} must be an object`);
  }
}

function tenantDomainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
