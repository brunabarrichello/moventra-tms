import { performance } from 'node:perf_hooks';
import { parseMessageEnvelope } from '../../modules/messaging/message-envelope.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_BROKER_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export class RabbitMqDlqIngestionConsumer {
  constructor({ messagingAdapter, repository, config, logger, sleep = defaultSleep } = {}) {
    if (!messagingAdapter || typeof messagingAdapter.getConnection !== 'function') {
      throw new TypeError('RabbitMqDlqIngestionConsumer requires a RabbitMQ messaging adapter');
    }
    if (!repository || typeof repository.quarantineOutboxMessage !== 'function') {
      throw new TypeError('RabbitMqDlqIngestionConsumer requires a DLQ ingestion repository');
    }
    if (!config || typeof config.deadLetterExchange !== 'string' || typeof config.queue !== 'string') {
      throw new TypeError('RabbitMqDlqIngestionConsumer requires a DLQ RabbitMQ configuration');
    }
    if (!logger || typeof logger.info !== 'function' || typeof logger.warn !== 'function' || typeof logger.error !== 'function') {
      throw new TypeError('RabbitMqDlqIngestionConsumer requires a logger');
    }
    if (typeof sleep !== 'function') {
      throw new TypeError('RabbitMqDlqIngestionConsumer requires a sleep function');
    }

    this.messagingAdapter = messagingAdapter;
    this.repository = repository;
    this.config = config;
    this.logger = logger;
    this.sleep = sleep;
    this.channel = null;
    this.consumerTag = null;
  }

  async start() {
    if (this.channel) {
      throw new Error('DLQ ingestion consumer is already started');
    }

    const connection = await this.messagingAdapter.getConnection();
    const channel = await connection.createChannel();
    try {
      await channel.assertExchange(this.config.deadLetterExchange, 'topic', { durable: true });
      // The ingestion queue intentionally has no DLX. A poison message must not create a
      // broker DLQ -> DLQ loop. Recoverable persistence failures are retried while unacked.
      await channel.assertQueue(this.config.queue, { durable: true });
      await channel.bindQueue(this.config.queue, this.config.deadLetterExchange, '#');
      await channel.prefetch(this.config.prefetch);
      const result = await channel.consume(
        this.config.queue,
        async (message) => this.#handleDelivery(channel, message),
        { noAck: false },
      );
      this.channel = channel;
      this.consumerTag = result.consumerTag;

      this.logger.info('DLQ ingestion consumer started', {
        event: 'dlq.ingestion.started',
        queue: this.config.queue,
        deadLetterExchange: this.config.deadLetterExchange,
      });

      return Object.freeze({
        queue: this.config.queue,
        deadLetterExchange: this.config.deadLetterExchange,
      });
    } catch (error) {
      await safeClose(channel);
      throw error;
    }
  }

  async close() {
    const channel = this.channel;
    const consumerTag = this.consumerTag;
    this.channel = null;
    this.consumerTag = null;
    if (!channel) {
      return;
    }
    try {
      if (consumerTag) {
        await channel.cancel(consumerTag);
      }
    } finally {
      await safeClose(channel);
    }
  }

  async #handleDelivery(channel, message) {
    if (!message) {
      return;
    }
    const startedAt = performance.now();
    const eventId = resolveTrustedLookupId(message);
    if (!eventId) {
      channel.nack(message, false, false);
      this.logger.warn('DLQ poison message rejected without requeue', {
        event: 'dlq.ingestion.rejected',
        reason: 'unresolvable_source_id',
        durationMs: performance.now() - startedAt,
      });
      return;
    }

    const metadata = buildDeadLetterMetadata(message);
    let lastError = null;
    for (let attempt = 1; attempt <= this.config.persistenceRetries; attempt += 1) {
      try {
        const quarantined = await this.repository.quarantineOutboxMessage({
          eventId,
          failureCode: 'MESSAGING_DEAD_LETTERED',
          failureClass: 'broker_dead_letter',
          metadata,
        });
        if (!quarantined) {
          channel.nack(message, false, false);
          this.logger.warn('DLQ dead-letter source was not found in authoritative Outbox', {
            event: 'dlq.ingestion.rejected',
            reason: 'authoritative_source_not_found',
            durationMs: performance.now() - startedAt,
          });
          return;
        }

        channel.ack(message);
        this.logger.info('DLQ message durably quarantined', {
          event: 'dlq.ingestion.persisted',
          sourceType: quarantined.sourceType,
          outcome: 'success',
          durationMs: performance.now() - startedAt,
        });
        return;
      } catch (error) {
        lastError = error;
        if (error?.retryable === false) {
          break;
        }
        if (attempt < this.config.persistenceRetries) {
          await this.sleep(retryDelay(attempt, this.config.retryBaseMs, this.config.retryMaxMs));
        }
      }
    }

    // A recoverable database outage is bounded per delivery. One broker redelivery is
    // allowed; a second exhausted delivery is rejected without requeue to prevent a hot
    // infinite loop. No ACK occurs unless PostgreSQL persistence succeeded.
    const requeue = lastError?.retryable !== false && message.fields?.redelivered !== true;
    channel.nack(message, false, requeue);
    this.logger.error('DLQ persistence failed', {
      event: 'dlq.ingestion.persistence_failed',
      outcome: requeue ? 'retryable_error' : 'terminal_error',
      error: lastError,
      durationMs: performance.now() - startedAt,
    });
  }
}

function resolveTrustedLookupId(message) {
  const propertyId = normalizeUuid(message.properties?.messageId);
  let envelopeId = null;
  try {
    const envelope = parseMessageEnvelope(message.content);
    envelopeId = normalizeUuid(envelope.eventId);
    if (envelope.messageId !== envelope.eventId) {
      return null;
    }
  } catch {
    // The broker property may still identify an authoritative Outbox event. The database
    // capability performs the trust decision and derives Tenant from Outbox, never here.
  }

  if (propertyId && envelopeId && propertyId !== envelopeId) {
    return null;
  }
  return envelopeId ?? propertyId;
}

function buildDeadLetterMetadata(message) {
  const headers = message.properties?.headers;
  const rawDeath = Array.isArray(headers?.['x-death']) ? headers['x-death'][0] : null;
  const count = Number(rawDeath?.count);
  return Object.freeze({
    broker: Object.freeze({
      reason: safeBrokerValue(rawDeath?.reason),
      exchange: safeBrokerValue(rawDeath?.exchange),
      queue: safeBrokerValue(rawDeath?.queue),
      count: Number.isInteger(count) && count >= 0 ? Math.min(count, 1_000_000) : null,
      redelivered: message.fields?.redelivered === true,
    }),
  });
}

function safeBrokerValue(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return SAFE_BROKER_VALUE.test(candidate) ? candidate : null;
}

function normalizeUuid(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_RE.test(candidate) ? candidate : null;
}

function retryDelay(attempt, baseMs, maxMs) {
  return Math.min(baseMs * (2 ** Math.min(attempt - 1, 10)), maxMs);
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function safeClose(resource) {
  try {
    await resource?.close?.();
  } catch {
    // Best-effort cleanup.
  }
}
