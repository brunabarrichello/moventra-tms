import amqp from 'amqplib';
import { performance } from 'node:perf_hooks';
import {
  createMessageEnvelope,
  normalizeMessageRoutingKey,
  parseMessageEnvelope,
  serializeMessageEnvelope,
} from '../../../modules/messaging/message-envelope.js';
import {
  classifyMessagingError,
  createMessagingError,
  MessagingError,
} from '../../../modules/messaging/messaging-errors.js';
import { recordMessagingOperation } from '../../../modules/messaging/messaging-observability.js';
import {
  normalizeTrustedExchangeName,
  normalizeTrustedQueueName,
} from './rabbitmq-config.js';

export class RabbitMqMessagingAdapter {
  constructor({ config, connect = amqp.connect } = {}) {
    if (!config || config.provider !== 'rabbitmq' || typeof config.brokerUrl !== 'string') {
      throw new TypeError('RabbitMqMessagingAdapter requires an enabled RabbitMQ configuration');
    }
    if (typeof connect !== 'function') {
      throw new TypeError('RabbitMqMessagingAdapter requires a connect function');
    }

    this.config = config;
    this.connect = connect;
    this.connection = null;
    this.confirmChannel = null;
    this.consumerChannels = new Set();
  }

  async publish({ envelope, routingKey } = {}) {
    const startedAt = performance.now();
    let normalizedEnvelope;
    try {
      normalizedEnvelope = createMessageEnvelope(envelope);
    } catch (cause) {
      observe('publish', 'rejected', startedAt);
      throw createMessagingError('invalid_envelope', { cause });
    }

    const normalizedRoutingKey = normalizeMessageRoutingKey(routingKey ?? normalizedEnvelope.eventType);
    if (normalizedRoutingKey !== normalizedEnvelope.eventType) {
      observe('publish', 'rejected', startedAt);
      throw createMessagingError('invalid_envelope', {
        message: 'Messaging routing key must match the validated event type',
      });
    }

    try {
      const channel = await this.getConfirmChannel();
      const content = serializeMessageEnvelope(normalizedEnvelope);
      channel.publish(this.config.exchange, normalizedRoutingKey, content, {
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        persistent: true,
        mandatory: true,
        messageId: normalizedEnvelope.messageId,
        correlationId: normalizedEnvelope.correlationId ?? undefined,
        type: normalizedEnvelope.eventType,
        timestamp: Math.floor(Date.parse(normalizedEnvelope.occurredAt) / 1000),
        headers: {
          'x-moventra-schema-version': normalizedEnvelope.schemaVersion,
          'x-moventra-event-id': normalizedEnvelope.eventId,
        },
      });

      await withTimeout(
        Promise.resolve(channel.waitForConfirms()),
        this.config.publishConfirmTimeoutMs,
      );
      observe('publish', 'success', startedAt);
      return Object.freeze({ messageId: normalizedEnvelope.messageId, confirmed: true });
    } catch (error) {
      this.confirmChannel = null;
      const mapped = mapPublishError(error);
      observe('publish', mapped.reason === 'publish_confirm_timeout' ? 'timeout' : 'retryable_error', startedAt);
      throw mapped;
    }
  }

  async subscribe({
    queue,
    routingKeys = ['#'],
    handler,
    prefetch = this.config.prefetch,
    deadLetterExchange = null,
  } = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('Messaging consumer handler must be a function');
    }
    const queueName = normalizeTrustedQueueName(queue);
    const bindings = normalizeBindings(routingKeys);
    const normalizedPrefetch = normalizePrefetch(prefetch);
    const normalizedDeadLetterExchange = deadLetterExchange === null || deadLetterExchange === undefined
      ? null
      : normalizeTrustedExchangeName(deadLetterExchange);

    const connection = await this.getConnection();
    let channel;
    try {
      channel = await connection.createChannel();
      this.consumerChannels.add(channel);
      await channel.assertExchange(this.config.exchange, 'topic', { durable: true });
      if (normalizedDeadLetterExchange) {
        await channel.assertExchange(normalizedDeadLetterExchange, 'topic', { durable: true });
      }
      const queueOptions = { durable: true };
      if (normalizedDeadLetterExchange) {
        queueOptions.arguments = { 'x-dead-letter-exchange': normalizedDeadLetterExchange };
      }
      await channel.assertQueue(queueName, queueOptions);
      for (const binding of bindings) {
        await channel.bindQueue(queueName, this.config.exchange, binding);
      }
      await channel.prefetch(normalizedPrefetch);

      const consumeResult = await channel.consume(
        queueName,
        async (message) => this.handleDelivery(channel, message, handler),
        { noAck: false },
      );

      return Object.freeze({
        consumerTag: consumeResult.consumerTag,
        close: async () => {
          try {
            await channel.cancel(consumeResult.consumerTag);
          } finally {
            this.consumerChannels.delete(channel);
            await safeClose(channel);
          }
        },
      });
    } catch (cause) {
      if (channel) {
        this.consumerChannels.delete(channel);
        await safeClose(channel);
      }
      throw createMessagingError('connection_failure', { cause });
    }
  }

  async handleDelivery(channel, message, handler) {
    const startedAt = performance.now();
    if (!message) {
      observe('consume', 'empty', startedAt);
      return;
    }

    let envelope;
    try {
      envelope = parseMessageEnvelope(message.content);
      if (
        (message.properties?.messageId && message.properties.messageId !== envelope.messageId)
        || (message.properties?.type && message.properties.type !== envelope.eventType)
      ) {
        throw createMessagingError('invalid_envelope');
      }
    } catch {
      channel.nack(message, false, false);
      observe('consume', 'rejected', startedAt);
      observe('nack', 'rejected', startedAt);
      return;
    }

    try {
      await handler(envelope);
      channel.ack(message);
      observe('consume', 'success', startedAt);
      observe('ack', 'success', startedAt);
    } catch (error) {
      const classification = classifyMessagingError(error);
      const requeue = classification.retryable === true && message.fields?.redelivered !== true;
      channel.nack(message, false, requeue);
      observe('consume', classification.retryable ? 'retryable_error' : 'rejected', startedAt);
      observe('nack', classification.retryable ? 'retryable_error' : 'rejected', startedAt);
    }
  }

  async getConnection() {
    if (this.connection) {
      return this.connection;
    }

    const startedAt = performance.now();
    try {
      const connection = await this.connect(this.config.brokerUrl, {
        clientProperties: {
          connection_name: 'moventra-tms',
        },
      });
      this.connection = connection;
      const invalidate = () => {
        if (this.connection === connection) {
          this.connection = null;
          this.confirmChannel = null;
        }
      };
      connection.on?.('error', invalidate);
      connection.on?.('close', invalidate);
      observe('connect', 'success', startedAt);
      return connection;
    } catch (cause) {
      observe('connect', 'retryable_error', startedAt);
      throw createMessagingError('connection_failure', { cause });
    }
  }

  async getConfirmChannel() {
    if (this.confirmChannel) {
      return this.confirmChannel;
    }
    const connection = await this.getConnection();
    try {
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(this.config.exchange, 'topic', { durable: true });
      const invalidate = () => {
        if (this.confirmChannel === channel) {
          this.confirmChannel = null;
        }
      };
      channel.on?.('error', invalidate);
      channel.on?.('close', invalidate);
      this.confirmChannel = channel;
      return channel;
    } catch (cause) {
      throw createMessagingError('channel_closed', { cause });
    }
  }

  async close() {
    const startedAt = performance.now();
    const consumers = [...this.consumerChannels];
    this.consumerChannels.clear();
    await Promise.all(consumers.map(safeClose));
    await safeClose(this.confirmChannel);
    this.confirmChannel = null;
    await safeClose(this.connection);
    this.connection = null;
    observe('close', 'success', startedAt);
  }
}

function mapPublishError(error) {
  if (error instanceof MessagingError) {
    return error;
  }
  if (error?.code === 'MVT_MESSAGING_CONFIRM_TIMEOUT') {
    return createMessagingError('publish_confirm_timeout', { cause: error });
  }
  return createMessagingError('broker_nack', { cause: error });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Messaging publish confirmation timed out');
      error.code = 'MVT_MESSAGING_CONFIRM_TIMEOUT';
      reject(error);
    }, timeoutMs);
    timer.unref?.();
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

function normalizeBindings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new TypeError('Messaging routingKeys must be a non-empty bounded array');
  }
  return Object.freeze(value.map((item) => {
    if (item === '#') {
      return '#';
    }
    return normalizeMessageRoutingKey(item);
  }));
}

function normalizePrefetch(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 500) {
    throw new TypeError('Messaging prefetch is invalid');
  }
  return number;
}

async function safeClose(resource) {
  if (!resource || typeof resource.close !== 'function') {
    return;
  }
  try {
    await resource.close();
  } catch {
    // Best-effort graceful close.
  }
}

function observe(operation, outcome, startedAt) {
  recordMessagingOperation({
    operation,
    outcome,
    durationMs: performance.now() - startedAt,
  });
}
