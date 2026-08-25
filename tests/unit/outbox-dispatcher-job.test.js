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
