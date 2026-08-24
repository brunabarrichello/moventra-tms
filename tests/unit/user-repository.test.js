import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresUserRepository } from '../../src/modules/identity/user/user-repository.js';

const userId = '0198f1c0-4234-7abc-8def-0123456789ab';
const createdAt = new Date('2026-08-24T00:00:00.000Z');
const updatedAt = new Date('2026-08-24T00:00:00.000Z');

function userRow(overrides = {}) {
  return {
    id: userId,
    primary_email: 'person@example.com',
    display_name: 'Person Example',
    preferred_locale: 'pt-BR',
    preferred_timezone: 'America/Sao_Paulo',
    status: 'PENDING',
    created_at: createdAt,
    updated_at: updatedAt,
    version: '1',
    ...overrides,
  };
}

function validCreation(overrides = {}) {
  return {
    primaryEmail: 'person@example.com',
    displayName: 'Person Example',
    preferredLocale: 'pt-BR',
    preferredTimezone: 'America/Sao_Paulo',
    ...overrides,
  };
}

test('user repository creates a normalized global PENDING identity', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [userRow()] };
    },
  });

  const user = await repository.create(
    validCreation({ primaryEmail: ' PERSON@EXAMPLE.COM ', preferredLocale: 'pt-br' }),
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO identity\.users/);
  assert.deepEqual(calls[0].values, [
    'person@example.com',
    'Person Example',
    'pt-BR',
    'America/Sao_Paulo',
    'PENDING',
  ]);
  assert.equal(user.status, 'PENDING');
  assert.equal(user.version, '1');
});

test('user repository maps canonical primary email conflict', async () => {
  const repository = new PostgresUserRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_users_primary_email';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(validCreation()),
    (error) => error.code === 'MVT_USER_EMAIL_CONFLICT',
  );
});

test('user lookup by primary email always uses canonical email', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [userRow()] };
    },
  });

  const user = await repository.findByPrimaryEmail(' PERSON@EXAMPLE.COM ');

  assert.equal(user.id, userId);
  assert.match(calls[0].text, /WHERE primary_email = \$1/);
  assert.deepEqual(calls[0].values, ['person@example.com']);
});

test('user lookup by id is global and independent of tenant/provider context', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [userRow()] };
    },
  });

  const user = await repository.findById(userId);

  assert.equal(user.id, userId);
  assert.deepEqual(calls[0].values, [userId]);
  assert.doesNotMatch(calls[0].text, /tenant_id|company_id|branch_id|provider_subject/i);
});

test('profile update uses id and expected version for optimistic locking', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [
          userRow({
            primary_email: 'new@example.com',
            display_name: 'New Name',
            preferred_locale: 'en-US',
            preferred_timezone: null,
            version: '2',
          }),
        ],
      };
    },
  });

  const user = await repository.updateProfile(
    userId,
    {
      primaryEmail: 'NEW@EXAMPLE.COM',
      displayName: 'New Name',
      preferredLocale: 'en-us',
      preferredTimezone: null,
    },
    '1',
  );

  assert.equal(user.primaryEmail, 'new@example.com');
  assert.equal(user.version, '2');
  assert.match(calls[0].text, /WHERE id = \$1/);
  assert.match(calls[0].text, /AND version = \$6/);
  assert.match(calls[0].text, /version = version \+ 1/);
  assert.equal(calls[0].values.at(-1), '1');
});

test('stale profile update is surfaced as optimistic-lock conflict', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.startsWith('UPDATE')) {
        return { rows: [] };
      }

      return { rows: [{ version: '2' }] };
    },
  });

  await assert.rejects(
    () => repository.updateProfile(userId, validCreation(), '1'),
    (error) => error.code === 'MVT_USER_VERSION_CONFLICT',
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].values, [userId]);
});

test('transition uses current status and version atomically', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.includes('SELECT status, version')) {
        return { rows: [{ status: 'PENDING', version: '1' }] };
      }

      return { rows: [userRow({ status: 'ACTIVE', version: '2' })] };
    },
  });

  const user = await repository.transitionStatus(userId, 'ACTIVE', '1');

  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.version, '2');
  assert.match(calls[1].text, /WHERE id = \$1/);
  assert.match(calls[1].text, /AND status = \$3/);
  assert.match(calls[1].text, /AND version = \$4/);
  assert.deepEqual(calls[1].values, [userId, 'ACTIVE', 'PENDING', '1']);
});

test('transition rejects stale version before write', async () => {
  const calls = [];
  const repository = new PostgresUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [{ status: 'PENDING', version: '2' }] };
    },
  });

  await assert.rejects(
    () => repository.transitionStatus(userId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_USER_VERSION_CONFLICT',
  );

  assert.equal(calls.length, 1);
});

test('CLOSED user cannot transition back to ACTIVE', async () => {
  const repository = new PostgresUserRepository({
    query: async () => ({ rows: [{ status: 'CLOSED', version: '7' }] }),
  });

  await assert.rejects(
    () => repository.transitionStatus(userId, 'ACTIVE', '7'),
    (error) => error.code === 'MVT_USER_TRANSITION_INVALID',
  );
});
