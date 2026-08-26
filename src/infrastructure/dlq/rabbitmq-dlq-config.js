import {
  normalizeTrustedExchangeName,
  normalizeTrustedQueueName,
} from '../messaging/rabbitmq/rabbitmq-config.js';

const DEFAULT_DLX = 'moventra.dlx';
const DEFAULT_QUEUE = 'moventra.dlq.ingest';
const DEFAULT_PREFETCH = 10;
const DEFAULT_PERSIST_RETRIES = 5;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 5_000;

export function resolveRabbitMqDlqConfig(env = process.env) {
  const deadLetterExchange = normalizeTrustedExchangeName(env.DLQ_RABBITMQ_DLX ?? DEFAULT_DLX);
  const queue = normalizeTrustedQueueName(env.DLQ_RABBITMQ_QUEUE ?? DEFAULT_QUEUE);
  const prefetch = normalizeInteger(env.DLQ_RABBITMQ_PREFETCH, DEFAULT_PREFETCH, 1, 100, 'DLQ_RABBITMQ_PREFETCH');
  const persistenceRetries = normalizeInteger(
    env.DLQ_INGEST_PERSIST_RETRIES,
    DEFAULT_PERSIST_RETRIES,
    1,
    20,
    'DLQ_INGEST_PERSIST_RETRIES',
  );
  const retryBaseMs = normalizeInteger(
    env.DLQ_INGEST_RETRY_BASE_MS,
    DEFAULT_RETRY_BASE_MS,
    100,
    60_000,
    'DLQ_INGEST_RETRY_BASE_MS',
  );
  const retryMaxMs = normalizeInteger(
    env.DLQ_INGEST_RETRY_MAX_MS,
    DEFAULT_RETRY_MAX_MS,
    retryBaseMs,
    300_000,
    'DLQ_INGEST_RETRY_MAX_MS',
  );

  return Object.freeze({
    deadLetterExchange,
    queue,
    prefetch,
    persistenceRetries,
    retryBaseMs,
    retryMaxMs,
  });
}

function normalizeInteger(value, fallback, min, max, field) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    const error = new Error(`${field} is invalid`);
    error.code = 'MVT_DLQ_CONFIG_INVALID';
    error.retryable = false;
    throw error;
  }
  return number;
}
