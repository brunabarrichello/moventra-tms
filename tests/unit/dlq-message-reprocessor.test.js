import test from 'node:test';
import assert from 'node:assert/strict';

import { DlqMessageReprocessor } from '../../src/modules/dlq/message-reprocessor.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ENTRY_ID = '00000000-0000-7000-8000-000000000026';
const SOURCE_ID = '00000000-0000-7000-8000-000000000015';
const CLAIM_TOKEN = '00000000-0000-7000-8000-000000000099';
const EVENT_TYPE = 'freight.status_changed';
const NOW = new Date('2026-08-26T21:40:00.000Z');

function entry(overrides = {}) {
  return Object.freeze({
    id: ENTRY_ID,
    scope: 'tenant',
    tenantId: TENANT_ID,
    sourceKind: 'message',
    sourceId: SOURCE_ID,
    sourceType: EVENT_TYPE,
    sourceSchemaVersion: 1,
    snapshot: Object.freeze({
      messageId: SOURCE_ID,
      eventId: SOURCE_ID,
      tenantId: TENANT_ID,
      eventType: EVENT_TYPE,
      schemaVersion: 1,
      payload: { staleSnapshot: true },
    }),
    metadata: Object.freeze({}),
    status: 'quarantined',
    reprocessCount: 0,
    maxReprocessAttempts: 5,
    version: 7,
    ...overrides,
  });
}

function source(overrides = {}) {
  return Object.freeze({
    id: SOURCE_ID,
    tenantId: TENANT_ID,
    aggregateType: 'freight',
    aggregateId: '00000000-0000-7000-8000-000000000100',
    eventType: EVENT_TYPE,
    schemaVersion: 1,
    payload: Object.freeze({ authoritative: true }),
    metadata: Object.freeze({ correlationId: 'corr-026', causationId: 'cause-026' }),
    dedupeKey: null,
    occurredAt: '2026-08-26T20:00:00.000Z',
    availableAt: '2026-08-26T20:00:00.000Z',
    publishedAt: '2026-08-26T20:00:05.000Z',
    attemptCount: 1,
    lastAttemptAt: '2026-08-26T20:00:04.000Z',
    claimToken: null,
    claimedAt: null,
    createdAt: '2026-08-26T20:00:00.000Z',
    ...overrides,
  });
}

function createHarness({
  current = entry(),
  requested = entry({ status: 'reprocess_pending', version: 8 }),
  claimed = entry({
    status: 'reprocessing',
    version: 9,
    reprocessCount: 1,
    reprocessClaimToken: CLAIM_TOKEN,
  }),
  completed = entry({
    status: 'resolved',
    version: 10,
    reprocessCount: 1,
    resolutionCode: 'message_reprocessed',
  }),
  authoritativeSource = source(),
  publishResult = { confirmed: true, messageId: SOURCE_ID },
  publishError = null,
} = {}) {
  const calls = {
    request: [],
    claim: [],
    complete: [],
    fail: [],
    source: [],
    publish: [],
  };

  const dlqRepository = {
    async findById(input) {
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
        status: 'quarantined',
        version: 10,
        reprocessCount: claimed?.reprocessCount ?? 1,
        nextReprocessAt: input.nextReprocessAt,
        lastFailureCode: input.failureCode,
      });
    },
  };

  const sourceReader = {
    async findById(input) {
      calls.source.push(input);
      return authoritativeSource;
    },
  };

  const publisher = {
    async publish(input) {
      calls.publish.push(input);
      if (publishError) {
        throw publishError;
      }
      return publishResult;
    },
  };

  const service = new DlqMessageReprocessor({
    dlqRepository,
    sourceReader,
    publisher,
    claimTokenFactory: () => CLAIM_TOKEN,
    now: () => new Date(NOW),
    claimTtlMs: 60_000,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
  });

  return { service, calls };
}

test('reprocessa mensagem usando somente Outbox autoritativo e preserva identidade lógica', async () => {
  const { service, calls } = createHarness();

  const result = await service.reprocess({ id: ENTRY_ID, expectedVersion: 7 });

  assert.equal(result.confirmed, true);
  assert.equal(result.messageId, SOURCE_ID);
  assert.equal(result.entry.status, 'resolved');

  assert.deepEqual(calls.request, [{ id: ENTRY_ID, expectedVersion: 7 }]);
  assert.deepEqual(calls.claim, [{ id: ENTRY_ID, claimToken: CLAIM_TOKEN, claimTtlMs: 60_000 }]);
  assert.deepEqual(calls.source, [{ id: SOURCE_ID }]);
  assert.equal(calls.publish.length, 1);
  assert.equal(calls.publish[0].routingKey, EVENT_TYPE);
  assert.equal(calls.publish[0].envelope.messageId, SOURCE_ID);
  assert.equal(calls.publish[0].envelope.eventId, SOURCE_ID);
  assert.equal(calls.publish[0].envelope.tenantId, TENANT_ID);
  assert.equal(calls.publish[0].envelope.payload.authoritative, true);
  assert.equal(calls.publish[0].envelope.payload.staleSnapshot, undefined);
  assert.equal(calls.publish[0].envelope.correlationId, 'corr-026');
  assert.deepEqual(calls.complete, [{
    id: ENTRY_ID,
    claimToken: CLAIM_TOKEN,
    resolutionCode: 'message_reprocessed',
  }]);
  assert.equal(calls.fail.length, 0);
});

test('rejeita source_kind job antes de qualquer mutação de reprocessamento', async () => {
  const { service, calls } = createHarness({ current: entry({ sourceKind: 'job' }) });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error.code === 'MVT_DLQ_SOURCE_KIND_UNSUPPORTED' && error.retryable === false,
  );

  assert.equal(calls.request.length, 0);
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.source.length, 0);
  assert.equal(calls.publish.length, 0);
});

test('falha em optimistic concurrency sem adquirir claim nem publicar', async () => {
  const { service, calls } = createHarness({ requested: null });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 6 }),
    (error) => error.code === 'MVT_DLQ_REPROCESS_CONFLICT' && error.retryable === false,
  );

  assert.deepEqual(calls.request, [{ id: ENTRY_ID, expectedVersion: 6 }]);
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.source.length, 0);
  assert.equal(calls.publish.length, 0);
});

test('source autoritativo ausente registra falha bounded e não publica snapshot', async () => {
  const { service, calls } = createHarness({ authoritativeSource: null });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error.code === 'MVT_DLQ_SOURCE_NOT_FOUND' && error.retryable === false,
  );

  assert.equal(calls.publish.length, 0);
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_SOURCE_NOT_FOUND');
  assert.equal(calls.fail[0].nextReprocessAt, '2026-08-26T21:40:01.000Z');
});

test('mismatch entre DLQ imutável e Outbox autoritativo impede publicação', async () => {
  const { service, calls } = createHarness({
    authoritativeSource: source({ eventType: 'freight.other_event' }),
  });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error.code === 'MVT_DLQ_SOURCE_MISMATCH',
  );

  assert.equal(calls.publish.length, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_SOURCE_MISMATCH');
});

test('publisher sem confirmação retorna entrada para ciclo bounded e não resolve', async () => {
  const { service, calls } = createHarness({
    publishResult: { confirmed: false, messageId: SOURCE_ID },
  });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error.code === 'MVT_DLQ_PUBLISH_NOT_CONFIRMED' && error.retryable === true,
  );

  assert.equal(calls.publish.length, 1);
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_PUBLISH_NOT_CONFIRMED');
});

test('claim concorrente perdido não lê source nem produz efeito externo', async () => {
  const { service, calls } = createHarness({ claimed: null });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error.code === 'MVT_DLQ_REPROCESS_CLAIM_CONFLICT' && error.retryable === true,
  );

  assert.equal(calls.source.length, 0);
  assert.equal(calls.publish.length, 0);
  assert.equal(calls.fail.length, 0);
});

test('conflito de conclusão após publisher confirm preserva semântica at-least-once', async () => {
  const { service, calls } = createHarness({ completed: null });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error.code === 'MVT_DLQ_REPROCESS_COMPLETION_CONFLICT' && error.retryable === true,
  );

  assert.equal(calls.publish.length, 1);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].failureCode, 'MVT_DLQ_REPROCESS_COMPLETION_CONFLICT');
});

test('erro do provider é preservado e convertido em código estável para lifecycle DLQ', async () => {
  const providerError = new Error('broker failed');
  providerError.code = 'MVT_MESSAGING_BROKER_NACK';
  providerError.retryable = true;
  const { service, calls } = createHarness({ publishError: providerError });

  await assert.rejects(
    service.reprocess({ id: ENTRY_ID, expectedVersion: 7 }),
    (error) => error === providerError,
  );

  assert.equal(calls.fail.length, 1);
  assert.equal(calls.fail[0].failureCode, 'MVT_MESSAGING_BROKER_NACK');
});

test('constructor exige ports governados e limites bounded', () => {
  const validRepository = {
    findById() {},
    requestReprocess() {},
    claimReprocess() {},
    completeReprocess() {},
    failReprocess() {},
  };
  const validSourceReader = { findById() {} };
  const validPublisher = { publish() {} };

  assert.throws(
    () => new DlqMessageReprocessor({
      dlqRepository: validRepository,
      sourceReader: validSourceReader,
      publisher: validPublisher,
      claimTtlMs: 999,
    }),
    /claimTtlMs/,
  );

  assert.throws(
    () => new DlqMessageReprocessor({
      dlqRepository: validRepository,
      sourceReader: {},
      publisher: validPublisher,
    }),
    /sourceReader/,
  );
});
