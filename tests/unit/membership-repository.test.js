import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresMembershipRepository } from '../../src/modules/identity/membership/membership-repository.js';

const tenantId = '0198f1c0-1111-7abc-8def-0123456789ab';
const otherTenantId = '0198f1c0-2222-7abc-8def-0123456789ab';
const userId = '0198f1c0-3333-7abc-8def-0123456789ab';
const membershipId = '0198f1c0-4444-7abc-8def-0123456789ab';
const createdAt = new Date('2026-08-24T00:00:00.000Z');
const updatedAt = new Date('2026-08-24T00:00:00.000Z');

function membershipRow(overrides = {}) {
  return {
    id: membershipId,
    tenant_id: tenantId,
    user_id: userId,
    status: 'PENDING',
    created_at: createdAt,
    updated_at: updatedAt,
    version: '1',
    ...overrides,
  };
}

test('membership repository creates a tenant-scoped PENDING association', async () => {
  const calls = [];
  const repository = new PostgresMembershipRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [membershipRow()] };
    },
  });

  const membership = await repository.create(tenantId, userId);

  assert.equal(membership.status, 'PENDING');
  assert.equal(membership.version, '1');
  assert.match(calls[0].text, /INSERT INTO identity\.memberships/);
  assert.deepEqual(calls[0].values, [tenantId, userId, 'PENDING']);
});

test('duplicate User Membership inside the same Tenant maps to a stable conflict', async () => {
  const repository = new PostgresMembershipRepository({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'uq_memberships_tenant_user';
      throw error;
    },
  });

  await assert.rejects(
    () => repository.create(tenantId, userId),
    (error) => error.code === 'MVT_MEMBERSHIP_CONFLICT',
  );
});

test('membership create maps missing Tenant and User foreign keys separately', async () => {
  for (const [constraint, expectedCode] of [
    ['fk_memberships_tenant_id', 'MVT_MEMBERSHIP_TENANT_NOT_FOUND'],
    ['fk_memberships_user_id', 'MVT_MEMBERSHIP_USER_NOT_FOUND'],
  ]) {
    const repository = new PostgresMembershipRepository({
      query: async () => {
        const error = new Error('foreign key');
        error.code = '23503';
        error.constraint = constraint;
        throw error;
      },
    });

    await assert.rejects(
      () => repository.create(tenantId, userId),
      (error) => error.code === expectedCode,
    );
  }
});

test('membership lookups always require tenant scope', async () => {
  const calls = [];
  const repository = new PostgresMembershipRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [membershipRow()] };
    },
  });

  await repository.findById(tenantId, membershipId);
  await repository.findByUserId(tenantId, userId);

  assert.match(calls[0].text, /WHERE tenant_id = \$1[\s\S]*AND id = \$2/);
  assert.deepEqual(calls[0].values, [tenantId, membershipId]);
  assert.match(calls[1].text, /WHERE tenant_id = \$1[\s\S]*AND user_id = \$2/);
  assert.deepEqual(calls[1].values, [tenantId, userId]);
});

test('wrong Tenant lookup does not discover Membership', async () => {
  const repository = new PostgresMembershipRepository({
    query: async (_text, values) => {
      assert.equal(values[0], otherTenantId);
      return { rows: [] };
    },
  });

  assert.equal(await repository.findById(otherTenantId, membershipId), null);
});

test('membership activation uses tenant scope, version, current state and atomic parent checks', async () => {
  const calls = [];
  const repository = new PostgresMembershipRepository({
    query: async (text, values) => {
      calls.push({ text, values });

      if (text.includes('SELECT m.status')) {
        return {
          rows: [
            {
              status: 'PENDING',
              version: '1',
              tenant_status: 'ACTIVE',
              user_status: 'ACTIVE',
            },
          ],
        };
      }

      return { rows: [membershipRow({ status: 'ACTIVE', version: '2' })] };
    },
  });

  const membership = await repository.transitionStatus(tenantId, membershipId, 'ACTIVE', '1');

  assert.equal(membership.status, 'ACTIVE');
  assert.equal(membership.version, '2');
  assert.match(calls[1].text, /m\.tenant_id = \$1/);
  assert.match(calls[1].text, /m\.id = \$2/);
  assert.match(calls[1].text, /m\.status = \$4/);
  assert.match(calls[1].text, /m\.version = \$5/);
  assert.match(calls[1].text, /organization\.tenants/);
  assert.match(calls[1].text, /identity\.users/);
  assert.match(calls[1].text, /t\.status = 'ACTIVE'/);
  assert.match(calls[1].text, /u\.status = 'ACTIVE'/);
});

test('membership activation rejects non-operational parent before write', async () => {
  const calls = [];
  const repository = new PostgresMembershipRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [
          {
            status: 'PENDING',
            version: '1',
            tenant_status: 'ACTIVE',
            user_status: 'SUSPENDED',
          },
        ],
      };
    },
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, membershipId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_MEMBERSHIP_USER_NOT_OPERATIONAL',
  );
  assert.equal(calls.length, 1);
});

test('atomic activation race is surfaced as activation blocked', async () => {
  let stateReads = 0;
  const repository = new PostgresMembershipRepository({
    query: async (text) => {
      if (text.includes('SELECT m.status')) {
        stateReads += 1;
        return {
          rows: [
            {
              status: 'PENDING',
              version: '1',
              tenant_status: 'ACTIVE',
              user_status: stateReads === 1 ? 'ACTIVE' : 'SUSPENDED',
            },
          ],
        };
      }

      return { rows: [] };
    },
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, membershipId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_MEMBERSHIP_ACTIVATION_BLOCKED',
  );
});

test('stale membership version is rejected before transition write', async () => {
  const repository = new PostgresMembershipRepository({
    query: async () => ({
      rows: [
        {
          status: 'PENDING',
          version: '2',
          tenant_status: 'ACTIVE',
          user_status: 'ACTIVE',
        },
      ],
    }),
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, membershipId, 'ACTIVE', '1'),
    (error) => error.code === 'MVT_MEMBERSHIP_VERSION_CONFLICT',
  );
});

test('REVOKED membership cannot transition back to ACTIVE', async () => {
  const repository = new PostgresMembershipRepository({
    query: async () => ({
      rows: [
        {
          status: 'REVOKED',
          version: '7',
          tenant_status: 'ACTIVE',
          user_status: 'ACTIVE',
        },
      ],
    }),
  });

  await assert.rejects(
    () => repository.transitionStatus(tenantId, membershipId, 'ACTIVE', '7'),
    (error) => error.code === 'MVT_MEMBERSHIP_TRANSITION_INVALID',
  );
});
