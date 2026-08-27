import assert from 'node:assert/strict';
import test from 'node:test';

import { DlqAdminService } from '../../src/modules/dlq/dlq-admin-service.js';

const TENANT_ID = '01990226-0000-7000-8000-000000000001';
const USER_ID = '01990226-0000-7000-8000-000000000002';
const MEMBERSHIP_ID = '01990226-0000-7000-8000-000000000003';
const ENTRY_ID = '01990226-0000-7000-8000-000000000004';
const SOURCE_ID = '01990226-0000-7000-8000-000000000005';

function common() {
  return {
    tenantId: TENANT_ID,
    verifiedAssertion: { providerKey: 'test-idp', issuer: 'https://idp.test', subject: 'operator' },
    requestId: 'req-admin-1', correlationId: 'corr-admin-1',
  };
}
function entry(overrides = {}) {
  return {
    id: ENTRY_ID, scope: 'tenant', tenantId: TENANT_ID, sourceKind: 'message', sourceId: SOURCE_ID,
    sourceType: 'freight.changed', sourceSchemaVersion: 1, failureCode: 'MVT_MESSAGE_FAILED', failureClass: 'terminal',
    snapshot: { messageId: SOURCE_ID, authorization: 'must-redact' }, metadata: { nested: { token: 'must-redact' } },
    status: 'quarantined', quarantinedAt: '2026-08-26T22:00:00.000Z', reprocessCount: 0, maxReprocessAttempts: 5,
    nextReprocessAt: null, lastReprocessAt: null, lastFailureCode: null, resolvedAt: null, resolutionCode: null,
    version: 1, createdAt: '2026-08-26T22:00:00.000Z', updatedAt: '2026-08-26T22:00:00.000Z', ...overrides,
  };
}
function securityHarness() {
  const calls = [];
  const stored = new Map();
  return {
    calls,
    security: { execute: async (request, operation) => {
      calls.push(request);
      const context = { tenantId: TENANT_ID, user: { id: USER_ID }, membership: { id: MEMBERSHIP_ID }, query: async () => ({ rowCount: 0, rows: [] }) };
      if (!request.idempotency) { return operation(context); }
      if (stored.has(request.idempotency.key)) {
        return { value: stored.get(request.idempotency.key), idempotency: { status: 200, outcome: 'replayed', replayed: true } };
      }
      const value = await operation(context);
      stored.set(request.idempotency.key, value);
      return { value, idempotency: { status: 200, outcome: 'executed', replayed: false } };
    } },
  };
}

test('list/read are tenant-only, require dlq.read and redact sensitive metadata', async () => {
  const harness = securityHarness();
  const repository = { list: async () => [entry()], findById: async () => entry() };
  const service = new DlqAdminService({ security: harness.security, dlqRepositoryFactory: () => repository });
  const listed = await service.list({ ...common(), filters: { limit: 1 } });
  assert.equal(harness.calls[0].permission, 'dlq.read');
  assert.deepEqual(harness.calls[0].scope, { level: 'TENANT' });
  assert.equal(listed.items[0].snapshot.authorization, '[REDACTED]');
  assert.equal(listed.items[0].metadata.nested.token, '[REDACTED]');
  assert.ok(listed.page.nextCursor);
  assert.equal((await service.get({ ...common(), id: ENTRY_ID })).id, ENTRY_ID);
});

test('resolve is idempotent, versioned, fixed-code and audited exactly once', async () => {
  const harness = securityHarness();
  const audits = [];
  let resolveCalls = 0;
  const repository = {
    findById: async () => entry(),
    resolve: async (input) => {
      resolveCalls += 1;
      assert.deepEqual(input, { id: ENTRY_ID, expectedVersion: 1, actorId: MEMBERSHIP_ID, resolutionCode: 'resolved_by_operator' });
      return entry({ status: 'resolved', version: 2, resolutionCode: 'resolved_by_operator' });
    },
  };
  const service = new DlqAdminService({
    security: harness.security, dlqRepositoryFactory: () => repository,
    auditRepositoryFactory: () => ({ append: async (event) => audits.push(event) }),
  });
  const request = { ...common(), id: ENTRY_ID, expectedVersion: 1, idempotencyKey: 'idem-resolve-1', payload: { forbidden: true }, resolutionCode: 'forbidden' };
  const first = await service.resolve(request);
  const replay = await service.resolve(request);
  assert.equal(harness.calls[0].permission, 'dlq.resolve');
  assert.deepEqual(harness.calls[0].idempotency.fingerprintInput, { id: ENTRY_ID, expectedVersion: 1, action: 'resolve' });
  assert.equal(resolveCalls, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorMembershipId, MEMBERSHIP_ID);
  assert.equal(first.idempotency.replayed, false);
  assert.equal(replay.idempotency.replayed, true);
});

test('stale version prevents terminal mutation', async () => {
  const harness = securityHarness();
  let mutations = 0;
  const service = new DlqAdminService({
    security: harness.security,
    dlqRepositoryFactory: () => ({ findById: async () => entry({ version: 2 }), discard: async () => { mutations += 1; return null; } }),
  });
  await assert.rejects(service.discard({ ...common(), id: ENTRY_ID, expectedVersion: 1, idempotencyKey: 'idem-discard-1' }), (error) => error.category === 'CONCURRENCY');
  assert.equal(mutations, 0);
});

test('existing Auth/RBAC plain errors are translated to public AppError categories', async () => {
  const auth = new DlqAdminService({ security: { execute: async () => { const error = new Error('x'); error.code = 'MVT_AUTH_IDENTITY_UNAVAILABLE'; throw error; } } });
  await assert.rejects(auth.list({ ...common(), filters: {} }), (error) => error.category === 'AUTHENTICATION');
  const rbac = new DlqAdminService({ security: { execute: async () => { const error = new Error('x'); error.code = 'MVT_RBAC_FORBIDDEN'; throw error; } } });
  await assert.rejects(rbac.list({ ...common(), filters: {} }), (error) => error.category === 'AUTHORIZATION');
});
