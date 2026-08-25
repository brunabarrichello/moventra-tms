import assert from 'node:assert/strict';
import test from 'node:test';
import { JobHandlerRegistry } from '../../src/modules/jobs/job-handler-registry.js';
import { JobWorker } from '../../src/modules/jobs/job-worker.js';

const JOB = Object.freeze({
  id: '01990250-0000-7000-8000-000000000010',
  tenantId: null,
  scope: 'system',
  jobType: 'system.release_smoke',
  schemaVersion: 1,
  payload: Object.freeze({}),
  metadata: Object.freeze({}),
  attemptCount: 1,
  maxAttempts: 3,
  leaseToken: '01990250-0000-7000-8000-000000000099',
});

function fakeRepository(job = JOB) {
  const state = { completed: 0, failed: [] };
  return {
    state,
    async reapExpiredExhausted() { return 0; },
    async claimBatch() { return [job]; },
    async heartbeat() { return true; },
    async completeSuccess() { state.completed += 1; return { ...job, status: 'succeeded' }; },
    async completeFailure(input) {
      state.failed.push(input);
      return { ...job, status: input.retryable ? 'retry_scheduled' : 'failed_terminal' };
    },
  };
}

test('worker claims, resolves handler and completes success conditionally by lease', async () => {
  const repository = fakeRepository();
  const registry = new JobHandlerRegistry().register({
    jobType: JOB.jobType, scope: 'system', handler: async () => {},
  });
  const worker = new JobWorker({ repository, registry, heartbeatMs: 500, handlerTimeoutMs: 2000 });
  const result = await worker.runOnce();
  assert.equal(result.claimed, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(repository.state.completed, 1);
});

test('worker schedules retry only for retryable handler errors', async () => {
  const repository = fakeRepository();
  const registry = new JobHandlerRegistry().register({
    jobType: JOB.jobType,
    scope: 'system',
    handler: async () => {
      const error = new Error('dependency unavailable');
      error.code = 'MVT_DEPENDENCY_UNAVAILABLE';
      error.retryable = true;
      throw error;
    },
  });
  const worker = new JobWorker({
    repository, registry, heartbeatMs: 500, handlerTimeoutMs: 2000, random: () => 0,
  });
  const result = await worker.runOnce();
  assert.equal(result.retryScheduled, 1);
  assert.equal(repository.state.failed[0].retryable, true);
  assert.equal(repository.state.failed[0].delayMs, 1000);
});
