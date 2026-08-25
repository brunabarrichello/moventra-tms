import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineOutboxEventContract,
  normalizeOutboxAppendInput,
} from '../../src/modules/outbox/outbox-contract.js';
import { normalizeOutboxMetricAttributes } from '../../src/modules/outbox/outbox-observability.js';
import { OutboxService } from '../../src/modules/outbox/outbox-service.js';

const TENANT_ID = '01990233-0000-7000-8000-000000000001';
const EVENT_ID = '01990233-0000-7000-8000-000000000010';
const CLAIM_TOKEN = '01990233-0000-7000-8000-000000000020';
const FREIGHT_CREATED = defineOutboxEventContract({
  aggregateType: 'freight',
  eventType: 'freight.created',
  schemaVersion: 1,
});

test('outbox contract is application-defined, normalized and strips arbitrary metadata surface', () => {
  const normalized = normalizeOutboxAppendInput({
    contract: FREIGHT_CREATED,
    aggregateId: '01990233-0000-7000-8000-000000000100',
    payload: { freightId: 'f-1', facts: { status: 'CREATED' } },
    metadata: { correlationId: 'corr-1' },
    dedupeKey: 'freight:f-1:created',
  }, TENANT_ID);

  assert.equal(normalized.tenantId, TENANT_ID);
  assert.equal(normalized.aggregateType, 'freight');
  assert.equal(normalized.eventType, 'freight.created');
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.metadata.schemaVersion, 1);
  assert.equal(normalized.availableDelayMs, 0);
});

test('outbox rejects unbranded event contracts, sensitive payload keys and non-allowlisted metadata', () => {
  assert.throws(
    () => normalizeOutboxAppendInput({
      contract: { aggregateType: 'freight', eventType: 'freight.created', schemaVersion: 1 },
      payload: {},
    }, TENANT_ID),
    (error) => error.code === 'MVT_OUTBOX_CONTRACT_UNREGISTERED',
  );

  assert.throws(
    () => normalizeOutboxAppendInput({
      contract: FREIGHT_CREATED,
      payload: { nested: { authorization: 'redacted-fixture' } },
    }, TENANT_ID),
    (error) => error.code === 'MVT_OUTBOX_PAYLOAD_SENSITIVE',
  );

  assert.throws(
    () => normalizeOutboxAppendInput({
      contract: FREIGHT_CREATED,
      payload: {},
      metadata: { arbitraryHeader: 'x' },
    }, TENANT_ID),
    (error) => error.code === 'MVT_OUTBOX_METADATA_INVALID',
  );
});

test('outbox service appends, claims and marks published without exposing identifiers as metric dimensions', async () => {
  const calls = [];
  const repository = {
    append: async (input) => {
      calls.push(['append', input]);
      return { id: EVENT_ID, ...input };
    },
    claimBatch: async (input) => {
      calls.push(['claim', input]);
      return [{ id: EVENT_ID, claimToken: input.claimToken }];
    },
    markPublished: async (input) => {
      calls.push(['publish', input]);
      return { id: input.eventId, publishedAt: '2026-08-25T00:00:00.000Z' };
    },
  };
  const service = new OutboxService({ repository });

  const appended = await service.append({
    tenantId: TENANT_ID,
    contract: FREIGHT_CREATED,
    payload: { freightId: 'f-1' },
  });
  assert.equal(appended.id, EVENT_ID);

  const claimed = await service.claimBatch({ limit: 5, claimTtlMs: 5_000, claimToken: CLAIM_TOKEN });
  assert.equal(claimed.claimToken, CLAIM_TOKEN);
  assert.equal(claimed.events.length, 1);

  const published = await service.markPublished({ eventId: EVENT_ID, claimToken: CLAIM_TOKEN });
  assert.equal(published.id, EVENT_ID);
  assert.deepEqual(calls.map(([name]) => name), ['append', 'claim', 'publish']);

  const attributes = normalizeOutboxMetricAttributes({ operation: 'claim', outcome: 'success' });
  assert.deepEqual(Object.keys(attributes).sort(), ['environment', 'operation', 'outcome']);
  for (const forbidden of ['tenantId', 'aggregateId', 'eventId', 'claimToken', 'correlationId']) {
    assert.equal(Object.hasOwn(attributes, forbidden), false);
  }
});

test('markPublished rejects stale or foreign claims without leaking event existence', async () => {
  const service = new OutboxService({
    repository: {
      append: async () => ({}),
      claimBatch: async () => [],
      markPublished: async () => null,
    },
  });

  await assert.rejects(
    service.markPublished({ eventId: EVENT_ID, claimToken: CLAIM_TOKEN }),
    (error) => error.code === 'MVT_OUTBOX_PUBLISH_CONFLICT',
  );
});
