import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMessageEnvelope,
  parseMessageEnvelope,
  serializeMessageEnvelope,
} from '../../src/modules/messaging/message-envelope.js';
import { mapOutboxEventToMessage } from '../../src/modules/messaging/outbox-message-mapper.js';

const IDS = Object.freeze({
  event: '01990240-0000-7000-8000-000000000001',
  tenant: '01990240-0000-7000-8000-000000000002',
});

function validEnvelope(overrides = {}) {
  return {
    messageId: IDS.event,
    eventId: IDS.event,
    tenantId: IDS.tenant,
    eventType: 'freight.created',
    schemaVersion: 1,
    occurredAt: '2026-08-25T19:00:00.000Z',
    correlationId: 'corr-024',
    causationId: null,
    payload: { freightId: 'synthetic' },
    ...overrides,
  };
}

test('canonical message envelope is immutable, normalized and round-trippable', () => {
  const envelope = createMessageEnvelope(validEnvelope({ eventType: ' FREIGHT.CREATED ' }));
  assert.equal(envelope.eventType, 'freight.created');
  assert.equal(envelope.occurredAt, '2026-08-25T19:00:00.000Z');
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.payload), true);

  const parsed = parseMessageEnvelope(serializeMessageEnvelope(envelope));
  assert.deepEqual(parsed, envelope);
});

test('message envelope rejects unknown top-level fields and sensitive payload keys', () => {
  assert.throws(
    () => createMessageEnvelope({ ...validEnvelope(), brokerUrl: 'not-allowed' }),
    { code: 'MVT_MESSAGING_ENVELOPE_INVALID' },
  );
  assert.throws(
    () => createMessageEnvelope(validEnvelope({ payload: { token: 'forbidden' } })),
    { code: 'MVT_MESSAGING_PAYLOAD_SENSITIVE' },
  );
});

test('message envelope validates canonical tenant and event identifiers', () => {
  assert.throws(
    () => createMessageEnvelope(validEnvelope({ tenantId: 'tenant-from-client' })),
    { code: 'MVT_MESSAGING_ENVELOPE_INVALID' },
  );
  assert.throws(
    () => createMessageEnvelope(validEnvelope({ eventType: 'free form event' })),
    { code: 'MVT_MESSAGING_EVENT_TYPE_INVALID' },
  );
});

test('outbox event maps to one stable logical message without changing payload', () => {
  const result = mapOutboxEventToMessage({
    id: IDS.event,
    tenantId: IDS.tenant,
    aggregateType: 'freight',
    aggregateId: '01990240-0000-7000-8000-000000000003',
    eventType: 'freight.created',
    schemaVersion: 1,
    payload: { freightId: 'synthetic' },
    metadata: { correlationId: 'corr-024', causationId: 'cause-024', schemaVersion: 1 },
    occurredAt: '2026-08-25T19:00:00.000Z',
  });

  assert.equal(result.envelope.messageId, IDS.event);
  assert.equal(result.envelope.eventId, IDS.event);
  assert.equal(result.envelope.tenantId, IDS.tenant);
  assert.equal(result.routingKey, 'freight.created');
  assert.deepEqual(result.envelope.payload, { freightId: 'synthetic' });
});
