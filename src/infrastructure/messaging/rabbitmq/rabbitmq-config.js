const PROVIDERS = new Set(['disabled', 'rabbitmq']);
const RUNTIME_ENVIRONMENTS = new Set(['development', 'test', 'ci', 'preview', 'staging', 'production']);
const EXCHANGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const QUEUE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const DEFAULT_EXCHANGE = 'moventra.events';
const DEFAULT_PREFETCH = 20;
const DEFAULT_CONFIRM_TIMEOUT_MS = 5_000;

export function resolveMessagingConfig(env = process.env) {
  const provider = normalizeProvider(env.MESSAGING_PROVIDER);
  if (provider === 'disabled') {
    return Object.freeze({ provider: 'disabled' });
  }

  const brokerUrl = normalizeBrokerUrl(env.MESSAGING_RABBITMQ_URL, runtimeEnvironment(env));
  const exchange = normalizeExchangeName(env.MESSAGING_EXCHANGE ?? DEFAULT_EXCHANGE);
  const prefetch = normalizeInteger(env.MESSAGING_PREFETCH, DEFAULT_PREFETCH, 1, 500, 'MESSAGING_PREFETCH');
  const publishConfirmTimeoutMs = normalizeInteger(
    env.MESSAGING_PUBLISH_CONFIRM_TIMEOUT_MS,
    DEFAULT_CONFIRM_TIMEOUT_MS,
    250,
    30_000,
    'MESSAGING_PUBLISH_CONFIRM_TIMEOUT_MS',
  );

  const config = {
    provider,
    exchange,
    prefetch,
    publishConfirmTimeoutMs,
  };
  Object.defineProperty(config, 'brokerUrl', {
    value: brokerUrl,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(config);
}

export function normalizeTrustedQueueName(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!QUEUE_NAME.test(candidate)) {
    throw configError('MVT_MESSAGING_QUEUE_INVALID', 'Messaging queue name is invalid');
  }
  return candidate;
}

export function normalizeTrustedExchangeName(value) {
  return normalizeExchangeName(value);
}

function normalizeProvider(value) {
  const candidate = typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : 'disabled';
  if (!PROVIDERS.has(candidate)) {
    throw configError('MVT_MESSAGING_PROVIDER_INVALID', 'Messaging provider is invalid');
  }
  return candidate;
}

function normalizeBrokerUrl(value, environment) {
  if (typeof value !== 'string' || !value.trim()) {
    throw configError('MVT_MESSAGING_BROKER_URL_REQUIRED', 'Messaging broker URL is required');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw configError('MVT_MESSAGING_BROKER_URL_INVALID', 'Messaging broker URL is invalid');
  }

  if (!['amqp:', 'amqps:'].includes(parsed.protocol)) {
    throw configError('MVT_MESSAGING_BROKER_URL_INVALID', 'Messaging broker URL protocol is invalid');
  }
  if (!parsed.hostname) {
    throw configError('MVT_MESSAGING_BROKER_URL_INVALID', 'Messaging broker host is required');
  }
  if (['staging', 'production'].includes(environment) && parsed.protocol !== 'amqps:') {
    throw configError('MVT_MESSAGING_TLS_REQUIRED', 'TLS is required for messaging outside local/CI environments');
  }

  return parsed.toString();
}

function normalizeExchangeName(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!EXCHANGE_NAME.test(candidate)) {
    throw configError('MVT_MESSAGING_EXCHANGE_INVALID', 'Messaging exchange name is invalid');
  }
  return candidate;
}

function normalizeInteger(value, defaultValue, min, max, fieldName) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw configError('MVT_MESSAGING_CONFIG_INVALID', `${fieldName} is invalid`);
  }
  return number;
}

function runtimeEnvironment(env) {
  const candidate = env.MOVENTRA_ENV?.trim()
    || env.VERCEL_TARGET_ENV?.trim()
    || env.VERCEL_ENV?.trim()
    || env.NODE_ENV?.trim()
    || 'development';
  const normalized = candidate.toLowerCase();
  return RUNTIME_ENVIRONMENTS.has(normalized) ? normalized : 'development';
}

function configError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
