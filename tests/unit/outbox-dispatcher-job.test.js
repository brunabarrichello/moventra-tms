import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutboxDispatcherHandler } from '../../src/modules/jobs/outbox-dispatcher-job.js';

const EVENT = Object.freeze({
  id: '01990250-0000-7000-8000-000000000020',
  tenantId: '01990250-0000-7000-8000-000000000001',
  eventType: 'freight.created',
  schemaVersion: 1,
  occurredAt: '2026-08-25T23:00:00.000Z',
  payload: Object.freeze({ freightId: '01990250-0000-7000-8000-000000000030' }),
  metadata: Object.freeze({}),
});

test('outbox dispatcher marks published only after publisher confirm', async () => {
  const calls = [];
  const handler = createOutboxDispatcherHandler({
    outboxService: {
      async claimBatch() { return { claimToken: '01990250-0000-7000-8000-000000000040', events: [EVENT] }; },
      async markPublished(input) { calls.push(['mark', input]); },
    },
    publisher: {
      async publish({ envelope }) { calls.push(['publish', envelope.messageId]); return { messageId: envelope.messageId, confirmed: true }; },
    },
  });
  const result = await handler();
  assert.equal(result.published, 1);
  assert.equal(calls[0][0], 'publish');
  assert.equal(calls[1][0], 'mark');
});

test('outbox dispatcher never marks event when broker confirm fails', async () => {
  let marked = false;
  const handler = createOutboxDispatcherHandler({
    outboxService: {
      async claimBatch() { return { claimToken: '01990250-0000-7000-8000-000000000040', events: [EVENT] }; },
      async markPublished() { marked = true; },
    },
    publisher: {
      async publish() {
        const error = new Error('broker down');
        error.retryable = true;
        throw error;
      },
    },
  });
  await assert.rejects(handler, /broker down/);
  assert.equal(marked, false);
});

test('outbox dispatcher leaves event recoverable when worker aborts during broker operation', async () => {
  let marked = false;
  const controller = new AbortController();
  const timeout = new Error('dispatcher timed out');
  timeout.code = 'MVT_JOB_HANDLER_TIMEOUT';
  timeout.retryable = true;
  const handler = createOutboxDispatcherHandler({
    outboxService: {
      async claimBatch() { return { claimToken: '01990250-0000-7000-8000-000000000040', events: [EVENT] }; },
      async markPublished() { marked = true; },
    },
    publisher: {
      async publish({ envelope }) {
        controller.abort(timeout);
        return { messageId: envelope.messageId, confirmed: true };
      },
    },
  });

  await assert.rejects(() => handler({ signal: controller.signal }), /dispatcher timed out/);
  assert.equal(marked, false);
});

test('outbox dispatcher exponentially backs off consecutive empty runs and resets after work', async () => {
  const batches = [[], [], [EVENT], []];
  const handler = createOutboxDispatcherHandler({
    outboxService: {
      async claimBatch() {
        return {
          claimToken: '01990250-0000-7000-8000-000000000040',
          events: batches.shift() ?? [],
        };
      },
      async markPublished() {},
    },
    publisher: {
      async publish({ envelope }) {
        return { messageId: envelope.messageId, confirmed: true };
      },
    },
    idleBackoffBaseMs: 1000,
    idleBackoffMaxMs: 10000,
  });

  const firstEmpty = await handler();
  const secondEmpty = await handler();
  const withWork = await handler();
  const afterReset = await handler();

  assert.equal(firstEmpty.nextRunDelayMs, 1000);
  assert.equal(secondEmpty.nextRunDelayMs, 2000);
  assert.equal(withWork.claimed, 1);
  assert.equal(withWork.nextRunDelayMs, undefined);
  assert.equal(afterReset.nextRunDelayMs, 1000);
});

test('outbox dispatcher caps idle delay at configured maximum', async () => {
  const handler = createOutboxDispatcherHandler({
    outboxService: {
      async claimBatch() { return { claimToken: '01990250-0000-7000-8000-000000000040', events: [] }; },
      async markPublished() {},
    },
    publisher: {
      async publish() { throw new Error('not expected'); },
    },
    idleBackoffBaseMs: 1000,
    idleBackoffMaxMs: 2500,
  });

  assert.equal((await handler()).nextRunDelayMs, 1000);
  assert.equal((await handler()).nextRunDelayMs, 2000);
  assert.equal((await handler()).nextRunDelayMs, 2500);
  assert.equal((await handler()).nextRunDelayMs, 2500);
});
