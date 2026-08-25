import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { RabbitMqMessagingAdapter } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-config.js';
import { createMessagingError } from '../../src/modules/messaging/messaging-errors.js';

const config = resolveMessagingConfig(process.env);
if (config.provider !== 'rabbitmq') {
  throw new Error('RabbitMQ messaging validation requires MESSAGING_PROVIDER=rabbitmq');
}

const suffix = randomUUID().replaceAll('-', '');
const successQueue = `moventra.messaging.smoke.success.${suffix}`;
const retryQueue = `moventra.messaging.smoke.retry.${suffix}`;
const deadLetterExchange = `moventra.messaging.smoke.dlx.${suffix}`;
const deadLetterQueue = `moventra.messaging.smoke.dead.${suffix}`;
const eventType = 'messaging.smoke';
const tenantId = randomUUID();
const adapter = new RabbitMqMessagingAdapter({ config });
let adminConnection;
let adminChannel;
let successSubscription;
let retrySubscription;

try {
  adminConnection = await amqp.connect(config.brokerUrl, {
    clientProperties: { connection_name: 'moventra-tms-messaging-validation-admin' },
  });
  adminChannel = await adminConnection.createChannel();
  await adminChannel.assertExchange(deadLetterExchange, 'topic', { durable: true });
  await adminChannel.assertQueue(deadLetterQueue, { durable: true });
  await adminChannel.bindQueue(deadLetterQueue, deadLetterExchange, '#');

  const successReceived = deferred();
  successSubscription = await adapter.subscribe({
    queue: successQueue,
    routingKeys: [eventType],
    handler: async (envelope) => {
      successReceived.resolve(envelope);
    },
  });

  const successMessageId = randomUUID();
  const successEnvelope = createEnvelope({
    messageId: successMessageId,
    tenantId,
    eventType,
    marker: 'publish-confirm-ack',
  });
  const publishResult = await adapter.publish({ envelope: successEnvelope, routingKey: eventType });
  if (publishResult.confirmed !== true || publishResult.messageId !== successMessageId) {
    throw new Error('RabbitMQ publisher confirm contract failed');
  }

  const received = await waitFor(successReceived.promise, 10_000, 'ack delivery');
  if (
    received.messageId !== successMessageId
    || received.eventId !== successMessageId
    || received.tenantId !== tenantId
    || received.eventType !== eventType
  ) {
    throw new Error('RabbitMQ consumed envelope did not preserve the canonical identity');
  }

  let retryAttempts = 0;
  retrySubscription = await adapter.subscribe({
    queue: retryQueue,
    routingKeys: [eventType],
    deadLetterExchange,
    handler: async () => {
      retryAttempts += 1;
      throw createMessagingError('handler_dependency_error');
    },
  });

  const deadLetterReceived = deferred();
  const deadConsumer = await adminChannel.consume(
    deadLetterQueue,
    (message) => {
      if (!message) {
        return;
      }
      deadLetterReceived.resolve(message);
      adminChannel.ack(message);
    },
    { noAck: false },
  );

  const retryMessageId = randomUUID();
  await adapter.publish({
    envelope: createEnvelope({
      messageId: retryMessageId,
      tenantId,
      eventType,
      marker: 'retry-then-dead-letter',
    }),
    routingKey: eventType,
  });

  const deadMessage = await waitFor(deadLetterReceived.promise, 15_000, 'dead-letter delivery');
  if (deadMessage.properties?.messageId !== retryMessageId) {
    throw new Error('RabbitMQ dead-letter contract did not preserve messageId');
  }
  if (retryAttempts < 2) {
    throw new Error('RabbitMQ retry contract did not redeliver the retryable message before dead-letter');
  }

  await adminChannel.cancel(deadConsumer.consumerTag);

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    provider: 'rabbitmq',
    publishConfirm: true,
    manualAck: true,
    boundedRetry: true,
    deadLetter: true,
  })}\n`);
} finally {
  await retrySubscription?.close().catch(() => {});
  await successSubscription?.close().catch(() => {});
  await adapter.close().catch(() => {});

  if (adminChannel) {
    await adminChannel.deleteQueue(successQueue).catch(() => {});
    await adminChannel.deleteQueue(retryQueue).catch(() => {});
    await adminChannel.deleteQueue(deadLetterQueue).catch(() => {});
    await adminChannel.deleteExchange(deadLetterExchange).catch(() => {});
    await adminChannel.close().catch(() => {});
  }
  await adminConnection?.close().catch(() => {});
}

function createEnvelope({ messageId, tenantId: tenant, eventType: type, marker }) {
  return {
    messageId,
    eventId: messageId,
    tenantId: tenant,
    eventType: type,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId: `smoke-${marker}`,
    causationId: null,
    payload: { marker },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function waitFor(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for RabbitMQ ${label}`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
