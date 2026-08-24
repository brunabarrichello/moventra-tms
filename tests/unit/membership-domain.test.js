import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEMBERSHIP_STATUS,
  assertMembershipActivationParents,
  assertMembershipTransition,
  canTransitionMembershipStatus,
  isMembershipOperational,
  normalizeMembershipExpectedVersion,
} from '../../src/modules/identity/membership/membership-domain.js';

test('membership lifecycle allows explicit transitions and REVOKED is terminal', () => {
  assert.equal(
    canTransitionMembershipStatus(MEMBERSHIP_STATUS.PENDING, MEMBERSHIP_STATUS.ACTIVE),
    true,
  );
  assert.equal(
    canTransitionMembershipStatus(MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.SUSPENDED),
    true,
  );
  assert.equal(
    canTransitionMembershipStatus(MEMBERSHIP_STATUS.SUSPENDED, MEMBERSHIP_STATUS.ACTIVE),
    true,
  );
  assert.equal(
    canTransitionMembershipStatus(MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.REVOKED),
    true,
  );
  assert.equal(
    canTransitionMembershipStatus(MEMBERSHIP_STATUS.REVOKED, MEMBERSHIP_STATUS.ACTIVE),
    false,
  );

  assert.throws(
    () => assertMembershipTransition(MEMBERSHIP_STATUS.REVOKED, MEMBERSHIP_STATUS.ACTIVE),
    (error) => error.code === 'MVT_MEMBERSHIP_TRANSITION_INVALID',
  );
});

test('membership activation requires both Tenant and User ACTIVE', () => {
  assert.doesNotThrow(() => assertMembershipActivationParents('ACTIVE', 'ACTIVE'));

  assert.throws(
    () => assertMembershipActivationParents('SUSPENDED', 'ACTIVE'),
    (error) => error.code === 'MVT_MEMBERSHIP_TENANT_NOT_OPERATIONAL',
  );

  assert.throws(
    () => assertMembershipActivationParents('ACTIVE', 'SUSPENDED'),
    (error) => error.code === 'MVT_MEMBERSHIP_USER_NOT_OPERATIONAL',
  );
});

test('only ACTIVE memberships are operational', () => {
  assert.equal(isMembershipOperational(MEMBERSHIP_STATUS.ACTIVE), true);
  assert.equal(isMembershipOperational(MEMBERSHIP_STATUS.PENDING), false);
  assert.equal(isMembershipOperational(MEMBERSHIP_STATUS.SUSPENDED), false);
  assert.equal(isMembershipOperational(MEMBERSHIP_STATUS.REVOKED), false);
});

test('membership expected version is normalized as positive integer string', () => {
  assert.equal(normalizeMembershipExpectedVersion(1), '1');
  assert.equal(normalizeMembershipExpectedVersion(12n), '12');
  assert.equal(normalizeMembershipExpectedVersion('9007199254740993'), '9007199254740993');

  assert.throws(
    () => normalizeMembershipExpectedVersion(0),
    (error) => error.code === 'MVT_MEMBERSHIP_VERSION_INVALID',
  );
});
