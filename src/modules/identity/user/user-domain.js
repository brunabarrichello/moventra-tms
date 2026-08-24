export const USER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
});

const userStatuses = new Set(Object.values(USER_STATUS));
const transitions = new Map([
  [USER_STATUS.PENDING, new Set([USER_STATUS.ACTIVE, USER_STATUS.CLOSED])],
  [USER_STATUS.ACTIVE, new Set([USER_STATUS.SUSPENDED, USER_STATUS.CLOSED])],
  [USER_STATUS.SUSPENDED, new Set([USER_STATUS.ACTIVE, USER_STATUS.CLOSED])],
  [USER_STATUS.CLOSED, new Set()],
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUserCreation(input) {
  assertRecord(input, 'User creation input');

  return {
    primaryEmail: normalizeUserPrimaryEmail(input.primaryEmail),
    displayName: normalizeUserDisplayName(input.displayName),
    preferredLocale: normalizeOptionalUserLocale(input.preferredLocale),
    preferredTimezone: normalizeOptionalUserTimezone(input.preferredTimezone),
    status: USER_STATUS.PENDING,
  };
}

export function normalizeUserProfileUpdate(input) {
  assertRecord(input, 'User profile update input');

  return {
    primaryEmail: normalizeUserPrimaryEmail(input.primaryEmail),
    displayName: normalizeUserDisplayName(input.displayName),
    preferredLocale: normalizeOptionalUserLocale(input.preferredLocale),
    preferredTimezone: normalizeOptionalUserTimezone(input.preferredTimezone),
  };
}

export function normalizeUserPrimaryEmail(value) {
  const email = requireString(value, 'User primary email').toLowerCase();

  if (email.length > 320 || !emailPattern.test(email)) {
    throw userDomainError(
      'MVT_USER_EMAIL_INVALID',
      'User primary email must be a valid canonical email address up to 320 characters',
    );
  }

  return email;
}

export function normalizeUserDisplayName(value) {
  const displayName = requireString(value, 'User display name');

  if (displayName.length < 2 || displayName.length > 160) {
    throw userDomainError(
      'MVT_USER_DISPLAY_NAME_INVALID',
      'User display name must contain between 2 and 160 characters',
    );
  }

  return displayName;
}

export function normalizeOptionalUserLocale(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw userDomainError(
      'MVT_USER_LOCALE_INVALID',
      'User preferred locale must be a string when provided',
    );
  }

  const locale = value.trim();

  if (!locale || locale.length > 35) {
    throw userDomainError('MVT_USER_LOCALE_INVALID', 'User preferred locale is invalid');
  }

  try {
    return new Intl.Locale(locale).toString();
  } catch {
    throw userDomainError(
      'MVT_USER_LOCALE_INVALID',
      'User preferred locale must be a valid BCP 47 locale identifier',
    );
  }
}

export function normalizeOptionalUserTimezone(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw userDomainError(
      'MVT_USER_TIMEZONE_INVALID',
      'User preferred timezone must be a string when provided',
    );
  }

  const timezone = value.trim();

  if (!timezone || timezone.length > 100) {
    throw userDomainError('MVT_USER_TIMEZONE_INVALID', 'User preferred timezone is invalid');
  }

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw userDomainError(
      'MVT_USER_TIMEZONE_INVALID',
      'User preferred timezone must be a valid IANA timezone identifier',
    );
  }
}

export function assertUserStatus(value) {
  if (!userStatuses.has(value)) {
    throw userDomainError('MVT_USER_STATUS_INVALID', `Unknown user status: ${value}`);
  }

  return value;
}

export function canTransitionUserStatus(fromStatus, toStatus) {
  assertUserStatus(fromStatus);
  assertUserStatus(toStatus);
  return transitions.get(fromStatus).has(toStatus);
}

export function assertUserTransition(fromStatus, toStatus) {
  if (!canTransitionUserStatus(fromStatus, toStatus)) {
    throw userDomainError(
      'MVT_USER_TRANSITION_INVALID',
      `User status transition ${fromStatus} -> ${toStatus} is not allowed`,
    );
  }
}

export function isUserOperational(status) {
  assertUserStatus(status);
  return status === USER_STATUS.ACTIVE;
}

export function normalizeUserExpectedVersion(value) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw userDomainError(
      'MVT_USER_VERSION_INVALID',
      'User expected version must be a positive integer',
    );
  }

  return normalized;
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw userDomainError('MVT_USER_INPUT_INVALID', `${label} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw userDomainError('MVT_USER_INPUT_INVALID', `${label} is required`);
  }

  return normalized;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw userDomainError('MVT_USER_INPUT_INVALID', `${label} must be an object`);
  }
}

function userDomainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
