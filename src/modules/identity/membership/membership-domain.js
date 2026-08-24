import { isTenantOperational } from '../../organization/tenant/tenant-domain.js';
import { isUserOperational } from '../user/user-domain.js';

export const MEMBERSHIP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
});

const membershipStatuses = new Set(Object.values(MEMBERSHIP_STATUS));
const transitions = new Map([
  [MEMBERSHIP_STATUS.PENDING, new Set([MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.REVOKED])],
  [MEMBERSHIP_STATUS.ACTIVE, new Set([MEMBERSHIP_STATUS.SUSPENDED, MEMBERSHIP_STATUS.REVOKED])],
  [MEMBERSHIP_STATUS.SUSPENDED, new Set([MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.REVOKED])],
  [MEMBERSHIP_STATUS.REVOKED, new Set()],
]);

export function assertMembershipStatus(value) {
  if (!membershipStatuses.has(value)) {
    throw membershipDomainError(
      'MVT_MEMBERSHIP_STATUS_INVALID',
      `Unknown membership status: ${value}`,
    );
  }

  return value;
}

export function canTransitionMembershipStatus(fromStatus, toStatus) {
  assertMembershipStatus(fromStatus);
  assertMembershipStatus(toStatus);
  return transitions.get(fromStatus).has(toStatus);
}

export function assertMembershipTransition(fromStatus, toStatus) {
  if (!canTransitionMembershipStatus(fromStatus, toStatus)) {
    throw membershipDomainError(
      'MVT_MEMBERSHIP_TRANSITION_INVALID',
      `Membership status transition ${fromStatus} -> ${toStatus} is not allowed`,
    );
  }
}

export function assertMembershipActivationParents(tenantStatus, userStatus) {
  if (!isTenantOperational(tenantStatus)) {
    throw membershipDomainError(
      'MVT_MEMBERSHIP_TENANT_NOT_OPERATIONAL',
      'Membership activation requires an ACTIVE Tenant',
    );
  }

  if (!isUserOperational(userStatus)) {
    throw membershipDomainError(
      'MVT_MEMBERSHIP_USER_NOT_OPERATIONAL',
      'Membership activation requires an ACTIVE User',
    );
  }
}

export function isMembershipOperational(status) {
  assertMembershipStatus(status);
  return status === MEMBERSHIP_STATUS.ACTIVE;
}

export function normalizeMembershipExpectedVersion(value) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw membershipDomainError(
      'MVT_MEMBERSHIP_VERSION_INVALID',
      'Membership expected version must be a positive integer',
    );
  }

  return normalized;
}

function membershipDomainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
