import assert from 'node:assert/strict';
import test from 'node:test';
import { RabbitMqMessagingAdapter } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-config.js';
import { createMessagingError } from '../../src/modules/messaging/messaging-errors.js';

const IDS = Object.freeze({
  event: '01990240-0000-7000-8000-000000000011',
  tenant: '01990240-0000-7000-8000-000000000012',
});

function envelope() {
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
  };
}

function config() {
  return Object.freeze({
    provider: 'rabbitmq',
    brokerUrl: 'amqp://guest:guest@127.0.0.1:5672/',
    exchange: 'moventra.events',
    prefetch: 20,
    publishConfirmTimeoutMs: 1_000,
  });
}

test('production RabbitMQ config requires TLS and hides broker URL from serialization', () => {
  assert.throws(
    () => resolveMessagingConfig({
      MESSAGING_PROVIDER: 'rabbitmq',
      MESSAGING_RABBITMQ_URL: 'amqp://user:pass@broker.internal/vhost',
      MOVENTRA_ENV: 'production',
    }),
    { code: 'MVT_MESSAGING_TLS_REQUIRED' },
  );

  const resolved = resolveMessagingConfig({
    MESSAGING_PROVIDER: 'rabbitmq',
    MESSAGING_RABBITMQ_URL: 'amqps://user:pass@broker.example/vhost',
    MOVENTRA_ENV: 'production',
  });
  assert.equal(resolved.brokerUrl.startsWith('amqps://'), true);
  assert.equal(JSON.stringify(resolved).includes('broker.example'), false);
  assert.equal(resolved.exchange, 'moventra.events');
});

test('publisher uses durable topic exchange, persistent message and broker confirms', async () => {
  const published = [];
  let confirms = 0;
  const channel = {
    async assertExchange(name, kind, options) {
      assert.equal(name, 'moventra.events');
      assert.equal(kind, 'topic');
      assert.equal(options.durable, true);
    },
    publish(exchange, routingKey, content, properties) {
      published.push({ exchange, routingKey, body: JSON.parse(content.toString('utf8')), properties });
      return true;
    },
    async waitForConfirms() {
      confirms += 1;
    },
    on() {},
    async close() {},
  };
  const connection = {
    async createConfirmChannel() { return channel; },
    on() {},
    async close() {},
  };
  const adapter = new RabbitMqMessagingAdapter({ config: config(), connect: async () => connection });

  const result = await adapter.publish({ envelope: envelope(), routingKey: 'freight.created' });
  assert.deepEqual(result, { messageId: IDS.event, confirmed: true });
  assert.equal(confirms, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].exchange, 'moventra.events');
  assert.equal(published[0].routingKey, 'freight.created');
  assert.equal(published[0].properties.persistent, true);
  assert.equal(published[0].properties.messageId, IDS.event);
  assert.equal(published[0].properties.type, 'freight.created');
  assert.equal(published[0].body.tenantId, IDS.tenant);
  await adapter.close();
});

test('consumer manually acks success and bounds retryable requeue to first delivery', async () => {
  let delivery;
  const acks = [];
  const nacks = [];
  const channel = {
    async assertExchange() {},
    async assertQueue() {},
    async bindQueue() {},
    async prefetch(value) { assert.equal(value, 20); },
    async consume(_queue, callback, options) {
      assert.equal(options.noAck, false);
      delivery = callback;
      return { consumerTag: 'consumer-024' };
    },
    ack(message) { acks.push(message); },
    nack(message, allUpTo, requeue) { nacks.push({ message, allUpTo, requeue }); },
    async cancel() {},
    async close() {},
  };
  const connection = {
    async createChannel() { return channel; },
    on() {},
    async close() {},
  };
  const adapter = new RabbitMqMessagingAdapter({ config: config(), connect: async () => connection });
  let mode = 'success';
  await adapter.subscribe({
    queue: 'moventra.freight.test',
    routingKeys: ['freight.created'],
    handler: async () => {
      if (mode === 'retry') {
        throw createMessagingError('handler_dependency_error');
      }
    },
  });

  const baseMessage = {
    content: Buffer.from(JSON.stringify(envelope())),
    properties: { messageId: IDS.event, type: 'freight.created' },
    fields: { redelivered: false },
  };

  await delivery(baseMessage);
  assert.equal(acks.length, 1);

  mode = 'retry';
  await delivery({ ...baseMessage, fields: { redelivered: false } });
  await delivery({ ...baseMessage, fields: { redelivered: true } });
  assert.equal(nacks.length, 2);
  assert.equal(nacks[0].requeue, true);
  assert.equal(nacks[1].requeue, false);
  await adapter.close();
});

test('consumer rejects invalid envelopes without calling handler', async () => {
  let delivery;
  let handlerCalls = 0;
  const nacks = [];
  const channel = {
    async assertExchange() {},
    async assertQueue() {},
    async bindQueue() {},
    async prefetch() {},
    async consume(_queue, callback) {
      delivery = callback;
      return { consumerTag: 'consumer-024-invalid' };
    },
    ack() {},
    nack(_message, _allUpTo, requeue) { nacks.push(requeue); },
    async cancel() {},
    async close() {},
  };
  const connection = {
    async createChannel() { return channel; },
    on() {},
    async close() {},
  };
  const adapter = new RabbitMqMessagingAdapter({ config: config(), connect: async () => connection });
  await adapter.subscribe({
    queue: 'moventra.freight.invalid',
    handler: async () => { handlerCalls += 1; },
  });

  await delivery({ content: Buffer.from('{bad-json'), properties: {}, fields: { redelivered: false } });
  assert.equal(handlerCalls, 0);
  assert.deepEqual(nacks, [false]);
  await adapter.close();
});
