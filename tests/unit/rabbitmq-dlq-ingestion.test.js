import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRabbitMqDlqConfig } from '../../src/infrastructure/dlq/rabbitmq-dlq-config.js';
import { RabbitMqDlqIngestionConsumer } from '../../src/infrastructure/dlq/rabbitmq-dlq-ingestion.js';

const EVENT_ID = '01990260-0000-7000-8000-000000000011';
const TENANT_ID = '01990260-0000-7000-8000-000000000012';

function envelope() {
  return {
    messageId: EVENT_ID,
    eventId: EVENT_ID,
    tenantId: TENANT_ID,
    eventType: 'freight.created',
    schemaVersion: 1,
    occurredAt: '2026-08-26T06:00:00.000Z',
    correlationId: null,
    causationId: null,
    payload: { freightId: 'synthetic' },
  };
}

function createHarness(quarantine) {
  let delivery;
  const acks = [];
  const nacks = [];
  const topology = [];
  const calls = [];
  const channel = {
    async assertExchange(name, type, options) { topology.push(['exchange', name, type, options]); },
    async assertQueue(name, options) { topology.push(['queue', name, options]); },
    async bindQueue(queue, exchange, routingKey) { topology.push(['binding', queue, exchange, routingKey]); },
    async prefetch(value) { topology.push(['prefetch', value]); },
    async consume(_queue, callback, options) {
      assert.equal(options.noAck, false);
      delivery = callback;
      return { consumerTag: 'dlq-unit-consumer' };
    },
    ack(message) { acks.push(message); },
    nack(message, allUpTo, requeue) { nacks.push({ message, allUpTo, requeue }); },
    async cancel() {},
    async close() {},
  };
  const messagingAdapter = {
    async getConnection() {
      return { async createChannel() { return channel; } };
    },
  };
  const repository = {
    async quarantineOutboxMessage(input) {
      calls.push(input);
      if (quarantine) {
        return quarantine(input, calls.length);
      }
      return { id: '01990260-0000-7000-8000-000000000099', sourceType: 'freight.created' };
    },
  };
  const logger = { info() {}, warn() {}, error() {} };
  const consumer = new RabbitMqDlqIngestionConsumer({
    messagingAdapter,
    repository,
    config: resolveRabbitMqDlqConfig({}),
    logger,
    sleep: async () => {},
  });
  return { consumer, getDelivery: () => delivery, acks, nacks, topology, calls };
}

function deadLetterMessage({ redelivered = false } = {}) {
  return {
    content: Buffer.from(JSON.stringify(envelope())),
    properties: {
      messageId: EVENT_ID,
      headers: {
        'x-death': [{ reason: 'rejected', exchange: 'moventra.events', queue: 'moventra.freight', count: 1 }],
      },
    },
    fields: { redelivered },
  };
}

test('consumer creates durable one-way topology and ACKs only after durable quarantine', async () => {
  const harness = createHarness();
  await harness.consumer.start();

  assert.deepEqual(harness.topology, [
    ['exchange', 'moventra.dlx', 'topic', { durable: true }],
    ['queue', 'moventra.dlq.ingest', { durable: true }],
    ['binding', 'moventra.dlq.ingest', 'moventra.dlx', '#'],
    ['prefetch', 10],
  ]);

  await harness.getDelivery()(deadLetterMessage());
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].eventId, EVENT_ID);
  assert.equal(Object.hasOwn(harness.calls[0], 'tenantId'), false);
  assert.equal(harness.acks.length, 1);
  assert.equal(harness.nacks.length, 0);
  await harness.consumer.close();
});

test('consumer retries recoverable persistence and bounds broker requeue', async () => {
  const transient = new Error('database temporarily unavailable');
  const recovered = createHarness(async (_input, attempt) => {
    if (attempt < 3) {
      throw transient;
    }
    return { id: '01990260-0000-7000-8000-000000000099', sourceType: 'freight.created' };
  });
  await recovered.consumer.start();
  await recovered.getDelivery()(deadLetterMessage());
  assert.equal(recovered.calls.length, 3);
  assert.equal(recovered.acks.length, 1);

  const failed = createHarness(async () => { throw transient; });
  await failed.consumer.start();
  await failed.getDelivery()(deadLetterMessage({ redelivered: false }));
  await failed.getDelivery()(deadLetterMessage({ redelivered: true }));
  assert.equal(failed.acks.length, 0);
  assert.equal(failed.nacks.length, 2);
  assert.equal(failed.nacks[0].requeue, true);
  assert.equal(failed.nacks[1].requeue, false);
  await recovered.consumer.close();
  await failed.consumer.close();
});

test('poison message cannot derive tenant from x-death and never loops', async () => {
  const harness = createHarness();
  await harness.consumer.start();
  const poison = {
    content: Buffer.from('{not-json'),
    properties: {
      headers: {
        'x-death': [{ reason: 'rejected', queue: 'tenant-controlled', tenantId: TENANT_ID, count: 999 }],
      },
    },
    fields: { redelivered: false },
  };

  await harness.getDelivery()(poison);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.acks.length, 0);
  assert.equal(harness.nacks.length, 1);
  assert.equal(harness.nacks[0].requeue, false);
  await harness.consumer.close();
});
