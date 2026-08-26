import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateJobBackoff } from '../../src/modules/jobs/job-backoff.js';
import { normalizeJobScheduleInput } from '../../src/modules/jobs/job-contract.js';
import { JobHandlerRegistry } from '../../src/modules/jobs/job-handler-registry.js';

const TENANT_ID = '01990250-0000-7000-8000-000000000001';

test('job contract enforces explicit tenant/system scope and bounded payloads', () => {
  const tenantJob = normalizeJobScheduleInput({
    scope: 'tenant', tenantId: TENANT_ID, jobType: 'freight.recalculate_eta', payload: { freightId: 'x' },
  });
  assert.equal(tenantJob.scope, 'tenant');
  assert.equal(tenantJob.tenantId, TENANT_ID);
  assert.throws(
    () => normalizeJobScheduleInput({ scope: 'system', tenantId: TENANT_ID, jobType: 'system.outbox_dispatch' }),
    /cannot carry tenantId/,
  );
  assert.throws(
    () => normalizeJobScheduleInput({ scope: 'system', jobType: 'system.outbox_dispatch', payload: { accessToken: 'secret' } }),
    /Sensitive job payload field/,
  );
});

test('job backoff is bounded and deterministic with injected random', () => {
  assert.equal(calculateJobBackoff({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 0 }), 1000);
  assert.equal(calculateJobBackoff({ attempt: 3, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 0 }), 4000);
  assert.equal(calculateJobBackoff({ attempt: 10, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 1 }), 10000);
});

test('handler registry rejects duplicate, scope mismatch and unsupported schema', () => {
  const registry = new JobHandlerRegistry().register({
    jobType: 'system.outbox_dispatch', scope: 'system', schemaVersions: [1], handler: async () => {},
  });
  assert.equal(typeof registry.resolve({ jobType: 'system.outbox_dispatch', scope: 'system', schemaVersion: 1 }), 'function');
  assert.throws(
    () => registry.resolve({ jobType: 'system.outbox_dispatch', scope: 'tenant', schemaVersion: 1 }),
    /scope does not match/,
  );
  assert.throws(
    () => registry.resolve({ jobType: 'system.outbox_dispatch', scope: 'system', schemaVersion: 2 }),
    /schema version is not supported/,
  );
});
