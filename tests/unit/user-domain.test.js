import assert from 'node:assert/strict';
import test from 'node:test';

import {
  USER_STATUS,
  assertUserTransition,
  canTransitionUserStatus,
  isUserOperational,
  normalizeOptionalUserLocale,
  normalizeUserCreation,
  normalizeUserExpectedVersion,
  normalizeUserPrimaryEmail,
} from '../../src/modules/identity/user/user-domain.js';

test('user creation normalizes provider-agnostic business identity and starts PENDING', () => {
  const user = normalizeUserCreation({
    primaryEmail: '  User.Name@Example.COM  ',
    displayName: '  Maria da Silva  ',
    preferredLocale: 'pt-br',
    preferredTimezone: 'America/Sao_Paulo',
  });

  assert.deepEqual(user, {
    primaryEmail: 'user.name@example.com',
    displayName: 'Maria da Silva',
    preferredLocale: 'pt-BR',
    preferredTimezone: 'America/Sao_Paulo',
    status: USER_STATUS.PENDING,
  });
});

test('user creation supports absent personal locale and timezone preferences', () => {
  const user = normalizeUserCreation({
    primaryEmail: 'operator@example.com',
    displayName: 'Operator',
  });

  assert.equal(user.preferredLocale, null);
  assert.equal(user.preferredTimezone, null);
});

test('primary email is canonicalized and invalid shapes are rejected', () => {
  assert.equal(normalizeUserPrimaryEmail(' PERSON@EXAMPLE.COM '), 'person@example.com');

  assert.throws(
    () => normalizeUserPrimaryEmail('not-an-email'),
    (error) => error.code === 'MVT_USER_EMAIL_INVALID',
  );
});

test('preferred locale uses Intl canonicalization and rejects invalid locale', () => {
  assert.equal(normalizeOptionalUserLocale('en-us'), 'en-US');
  assert.equal(normalizeOptionalUserLocale(null), null);

  assert.throws(
    () => normalizeOptionalUserLocale('invalid_locale_@@'),
    (error) => error.code === 'MVT_USER_LOCALE_INVALID',
  );
});

test('invalid IANA timezone is rejected', () => {
  assert.throws(
    () =>
      normalizeUserCreation({
        primaryEmail: 'person@example.com',
        displayName: 'Person',
        preferredTimezone: 'Mars/Olympus_Mons',
      }),
    (error) => error.code === 'MVT_USER_TIMEZONE_INVALID',
  );
});

test('user lifecycle allows explicit transitions and CLOSED is terminal', () => {
  assert.equal(canTransitionUserStatus(USER_STATUS.PENDING, USER_STATUS.ACTIVE), true);
  assert.equal(canTransitionUserStatus(USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED), true);
  assert.equal(canTransitionUserStatus(USER_STATUS.SUSPENDED, USER_STATUS.ACTIVE), true);
  assert.equal(canTransitionUserStatus(USER_STATUS.ACTIVE, USER_STATUS.CLOSED), true);
  assert.equal(canTransitionUserStatus(USER_STATUS.CLOSED, USER_STATUS.ACTIVE), false);

  assert.throws(
    () => assertUserTransition(USER_STATUS.CLOSED, USER_STATUS.ACTIVE),
    (error) => error.code === 'MVT_USER_TRANSITION_INVALID',
  );
});

test('only ACTIVE users are operational in the business identity lifecycle', () => {
  assert.equal(isUserOperational(USER_STATUS.ACTIVE), true);
  assert.equal(isUserOperational(USER_STATUS.PENDING), false);
  assert.equal(isUserOperational(USER_STATUS.SUSPENDED), false);
  assert.equal(isUserOperational(USER_STATUS.CLOSED), false);
});

test('user expected version is normalized as a positive integer string', () => {
  assert.equal(normalizeUserExpectedVersion(1), '1');
  assert.equal(normalizeUserExpectedVersion(42n), '42');
  assert.equal(normalizeUserExpectedVersion('9007199254740993'), '9007199254740993');

  assert.throws(
    () => normalizeUserExpectedVersion(0),
    (error) => error.code === 'MVT_USER_VERSION_INVALID',
  );
});
