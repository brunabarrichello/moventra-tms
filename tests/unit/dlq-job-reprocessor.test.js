import test from 'node:test';
import assert from 'node:assert/strict';

import { DlqJobReprocessor } from '../../src/modules/dlq/job-reprocessor.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ENTRY_ID = '00000000-0000-7000-8000-000000000026';
const SOURCE_JOB_ID = '00000000-0000-7000-8000-000000000016';
const CHILD_JOB_ID = '00000000-0000-7000-8000-000000000116';
const CLAIM_TOKEN = '00000000-0000-7000-8000-000000000099';
const NOW = new Date('2026-08-26T22:10:00.000Z');

function entry(overrides = {}) {
  return Object.freeze({
    id: ENTRY_ID,
    scope: 'tenant',
    tenantId: TENANT_ID,
    sourceKind: 'job',
    sourceId: SOURCE_JOB_ID,
    sourceType: 'freight.recalculate_eta',
    sourceSchemaVersion: 1,
    snapshot: Object.freeze({
      jobId: SOURCE_JOB_ID,
      tenantId: TENANT_ID,
      jobType: 'freight.recalculate_eta',
      schemaVersion: 1,
      attemptCount: 3,
      maxAttempts: 3,
      payload: { omitted: 'authoritative_job_reference' },
    }),
    metadata: Object.freeze({ origin: 'jobs.failed_terminal' }),
    status: 'quarantined',
    reprocessCount: 0,
    maxReprocessAttempts: 5,
    version: 4,
    ...overrides,
  });
}

function source(overrides = {}) {
  return Object.freeze({
    id: SOURCE_JOB_ID,
    tenantId: TENANT_ID,
    scope: 'tenant',
    jobType: 'freight.recalculate_eta',
    schemaVersion: 1,
    payload: Object.freeze({ freightId: '00000000-0000-7000-8000-000000000333' }),
    metadata: Object.freeze({ correlationId: 'corr-job-026' }),
    status: 'failed_terminal',
    priority: 10,
    availableAt: '2026-08-26T21:00:00.000Z',
    attemptCount: 3,
    maxAttempts: 3,
    scheduleKey: null,
    recurrenceIntervalMs: null,
    ...overrides,
  });
}

function child(overrides = {}) {
  return Object.freeze({
    id: CHILD_JOB_ID,
    tenantId: TENANT_ID,
    scope: 'tenant',
    jobType: 'freight.recalculate_eta',
    schemaVersion: 1,
    payload: Object.freeze({ freightId: '00000000-0000-7000-8000-000000000333' }),
    metadata: Object.freeze({ correlationId: 'corr-job-026' }),
    status: 'scheduled',
    priority: 10,
    availableAt: '2026-08-26T22:10:00.000Z',
    attemptCount: 0,
    maxAttempts: 3,
    scheduleKey: null,
    recurrenceIntervalMs: null,
    reprocessedFromJobId: SOURCE_JOB_ID,
    reprocessedFromDlqEntryId: ENTRY_ID,
    ...overrides,
  });
}

function createHarness(options = {}) {
  const current = options.current ?? entry();
  const requested = options.requested ?? Object.freeze({
    ...current,
    status: 'reprocess_pending',
    version: current.version + 1,
  });
  const claimed = options.claimed ?? Object.freeze({
    ...requested,
    status: 'reprocessing',
    version: requested.version + 1,
    reprocessCount: current.reprocessCount + 1,
    reprocessClaimToken: CLAIM_TOKEN,
  });
  const authoritativeJob = Object.hasOwn(options, 'authoritativeJob')
    ? options.authoritativeJob
    : source();
  const rescheduledJob = Object.hasOwn(options, 'rescheduledJob')
    ? options.rescheduledJob
    : child();
  const completed = Object.hasOwn(options, 'completed')
    ? options.completed
    : Object.freeze({
      ...claimed,
      status: 'resolved',
      version: claimed.version + 1,
      resolutionCode: 'job_reprocessed',
    });
  const registryError = options.registryError ?? null;

  const calls = {
    request: [],
    claim: [],
    source: [],
    registry: [],
    reschedule: [],
    complete: [],
    fail: [],
  };

  const dlqRepository = {
    async findById() {
      return current;
    },
    async requestReprocess(input) {
      calls.request.push(input);
      return requested;
    },
    async claimReprocess(input) {
      calls.claim.push(input);
      return claimed;
    },
    async completeReprocess(input) {
      calls.complete.push(input);
      return completed;
    },
    async failReprocess(input) {
      calls.fail.push(input);
      return entry({
        ...claimed,
        status: 'quarantined',
        version: claimed.version + 1,
        nextReprocessAt: input.nextReprocessAt,
        lastFailureCode: input.failureCode,
      });
    },
  };

  const jobRepository = {
    async findById(input) {
      calls.source.push(input);
      return authoritativeJob;
    },
    async rescheduleFromTerminal(input) {
      calls.reschedule.push(input);
      return rescheduledJob;
    },
  };

  const registry = {
    resolve(job) {
      calls.registry.push(job);
      if (registryError) {
        throw registryError;
      }
      return async () => {};
    },
  };

  const service = new DlqJobReprocessor({
    dlqRepository,
    jobRepository,
    registry,
    claimTokenFactory: () => CLAIM_TOKEN,
    now: () => new Date(NOW),
    claimTtlMs: 60_000,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
  });

  return { service, calls, fixtures: { current, requested, claimed, authoritativeJob, rescheduledJob } };
}

test('reprocessa Job terminal por releitura autoritativa e cria somente Job filho durável', async () => {
  const { service, calls } = createHarness();

  const result = await service.reprocess({ id: ENTRY_ID, expectedVersion: 4 });

  assert.equal(result.rescheduled, true);
  assert.equal(result.job.id, CHILD_JOB_ID);
  assert.equal(result.entry.status, 'resolved');
  assert.deepEqual(calls.request, [{ id: ENTRY_ID, expectedVersion: 4 }]);
  assert.deepEqual(calls.claim, [{ id: ENTRY_ID, claimToken: CLAIM_TOKEN, claimTtlMs: 60_000 }]);
  assert.deepEqual(calls.source, [{ id: SOURCE_JOB_ID }]);
  assert.equal(calls.registry.length, 1);
  assert.deepEqual(calls.reschedule, [{ sourceJobId: SOURCE_JOB_ID, dlqEntryId: ENTRY_ID }]);
  assert.deepEqual(calls.complete, [{
    id: ENTRY_ID,
    claimToken: CLAIM_TOKEN,
    resolutionCode: 'job_reprocessed',
  }]);
  assert.equal(calls.fail.length, 0);
});

test('retoma reprocess_pending com optimistic concurrency sem repetir request', async () => {
  const pending = entry({ status: 'reprocess_pending', version: 5 });
  const { service, calls } = createHarness({ current: pending });

  await service.reprocess({ id: ENTRY_ID, expectedVersion: 5 });

  assert.equal(calls.request.length, 0);
  assert.equal(calls.claim.length, 1);
  assert.equal(calls.reschedule.length, 1);
});

test('rejeita Job autoritativo divergente antes de reschedule', async () => {
  const mismatchedJob = source({ jobType: 'freight.other_job' });
  assert.notEqual(mismatchedJob.jobType, entry().sourceType);

  const { service, calls, fixtures } = createHarness({ authoritativeJob: mismatchedJob });
  assert.equal(fixtures.claimed.sourceType, 'freight.recalculate_eta');
  assert.equal(fixtures.authoritativeJob.jobType, 'freight.other_job');

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 4 }),
    (error) => error.code === 'MVT_DLQ_JOB_SOURCE_MISMATCH' && error.retryable === false,
  );

  assert.equal(calls.registry.length, 0);
  assert.equal(calls.reschedule.length, 0);
  assert.equal(calls.fail.length, 1);
});

test('rejeita Job que deixou de estar failed_terminal', async () => {
  const nonTerminalJob = source({ status: 'succeeded' });
  assert.equal(nonTerminalJob.status, 'succeeded');

  const { service, calls, fixtures } = createHarness({ authoritativeJob: nonTerminalJob });
  assert.equal(fixtures.authoritativeJob.status, 'succeeded');

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 4 }),
    (error) => error.code === 'MVT_DLQ_JOB_NOT_TERMINAL' && error.retryable === false,
  );

  assert.equal(calls.reschedule.length, 0);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_JOB_NOT_TERMINAL');
});

test('handler ausente bloqueia replay sem executar Job inline', async () => {
  const error = new Error('handler missing');
  error.code = 'MVT_JOB_HANDLER_NOT_FOUND';
  error.retryable = false;
  const { service, calls } = createHarness({ registryError: error });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 4 }),
    (candidate) => candidate === error,
  );

  assert.equal(calls.registry.length, 1);
  assert.equal(calls.reschedule.length, 0);
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail[0].failureCode, 'MVT_JOB_HANDLER_NOT_FOUND');
});

test('conflito de singleton retorna ao ciclo bounded sem resolver DLQ', async () => {
  const { service, calls } = createHarness({ rescheduledJob: null });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 4 }),
    (error) => error.code === 'MVT_DLQ_JOB_RESCHEDULE_CONFLICT' && error.retryable === true,
  );

  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].nextReprocessAt, '2026-08-26T22:10:01.000Z');
});

test('lineage divergente do Job filho impede resolução', async () => {
  const { service, calls } = createHarness({
    rescheduledJob: child({ reprocessedFromDlqEntryId: '00000000-0000-7000-8000-000000000999' }),
  });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 4 }),
    (error) => error.code === 'MVT_DLQ_JOB_LINEAGE_MISMATCH',
  );

  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_JOB_LINEAGE_MISMATCH');
});

test('conflito de conclusão após reschedule é retryable e preserva idempotência no repository', async () => {
  const { service, calls } = createHarness({ completed: null });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 4 }),
    (error) => error.code === 'MVT_DLQ_REPROCESS_COMPLETION_CONFLICT' && error.retryable === true,
  );

  assert.equal(calls.reschedule.length, 1);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_REPROCESS_COMPLETION_CONFLICT');
});

test('suporta system-scoped internamente sem representar tenant nulo em tabela tenant-scoped', async () => {
  const systemEntry = entry({
    scope: 'system',
    tenantId: null,
    sourceType: 'system.outbox_dispatch',
    snapshot: Object.freeze({
      jobId: SOURCE_JOB_ID,
      jobType: 'system.outbox_dispatch',
      schemaVersion: 1,
    }),
  });
  const systemSource = source({
    scope: 'system',
    tenantId: null,
    jobType: 'system.outbox_dispatch',
  });
  const systemChild = child({
    scope: 'system',
    tenantId: null,
    jobType: 'system.outbox_dispatch',
  });
  const { service, calls, fixtures } = createHarness({
    current: systemEntry,
    authoritativeJob: systemSource,
    rescheduledJob: systemChild,
  });

  assert.equal(fixtures.claimed.scope, 'system');
  assert.equal(fixtures.claimed.sourceType, 'system.outbox_dispatch');
  assert.equal(fixtures.authoritativeJob.scope, 'system');
  assert.equal(fixtures.authoritativeJob.jobType, 'system.outbox_dispatch');

  const result = await service.reprocess({ id: ENTRY_ID, expectedVersion: 4 });

  assert.equal(result.job.scope, 'system');
  assert.equal(result.job.tenantId, null);
  assert.equal(calls.reschedule.length, 1);
});
