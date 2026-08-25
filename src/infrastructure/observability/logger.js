import { trace } from '@opentelemetry/api';
import { getRequestContext } from './request-context.js';

const SENSITIVE_KEY = /(authorization|cookie|token|password|passwd|secret|api[_-]?key|database[_-]?url|connection[_-]?string|dsn|broker[_-]?url|messaging[_-]?.*url|rabbitmq[_-]?.*url|otel_exporter_otlp_headers)/i;
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 3;
const LEVEL_METHOD = Object.freeze({
  debug: 'debug',
  info: 'log',
  warn: 'warn',
  error: 'error',
});

export function createLogger(component, { sink = console } = {}) {
  const normalizedComponent = normalizeComponent(component);

  return Object.freeze({
    debug(message, metadata) {
      emitLog(sink, 'debug', normalizedComponent, message, metadata);
    },
    info(message, metadata) {
      emitLog(sink, 'info', normalizedComponent, message, metadata);
    },
    warn(message, metadata) {
      emitLog(sink, 'warn', normalizedComponent, message, metadata);
    },
    error(message, metadata) {
      emitLog(sink, 'error', normalizedComponent, message, metadata);
    },
  });
}

export function sanitizeLogMetadata(value, depth = 0) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value).slice(0, MAX_STRING_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return '[TRUNCATED]';
    }
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeLogMetadata(item, depth + 1));
  }

  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) {
      return '[TRUNCATED]';
    }

    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeLogMetadata(item, depth + 1);
    }
    return output;
  }

  return String(value).slice(0, MAX_STRING_LENGTH);
}

export function redactSensitiveText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/amqps?:\/\/[^\s]+/gi, '[REDACTED_MESSAGING_URL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|passwd|token|secret|api[_-]?key)=([^\s&,;]+)/gi, '$1=[REDACTED]');
}

function emitLog(sink, level, component, message, metadata) {
  const requestContext = getRequestContext();
  const spanContext = trace.getActiveSpan()?.spanContext();
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: 'moventra-tms',
    serviceVersion: runtimeVersion(),
    environment: runtimeEnvironment(),
    component,
    message: redactSensitiveText(normalizeMessage(message)).slice(0, MAX_STRING_LENGTH),
  };

  if (requestContext?.requestId) {
    record.requestId = requestContext.requestId;
  }
  if (requestContext?.correlationId) {
    record.correlationId = requestContext.correlationId;
  }
  if (spanContext?.traceId) {
    record.traceId = spanContext.traceId;
  }
  if (spanContext?.spanId) {
    record.spanId = spanContext.spanId;
  }

  const safeMetadata = sanitizeLogMetadata(metadata);
  if (safeMetadata && typeof safeMetadata === 'object' && !Array.isArray(safeMetadata)) {
    Object.assign(record, safeMetadata);
  } else if (safeMetadata !== null && safeMetadata !== undefined) {
    record.metadata = safeMetadata;
  }

  const method = LEVEL_METHOD[level] ?? 'log';
  try {
    const writer = typeof sink?.[method] === 'function' ? sink[method].bind(sink) : console.log;
    writer(JSON.stringify(record));
  } catch {
    // Telemetry/logging must never break the business request.
  }
}

function sanitizeError(error) {
  return {
    type: normalizeMessage(error?.name || 'Error').slice(0, 160),
    code: error?.code === undefined || error?.code === null
      ? null
      : normalizeMessage(error.code).slice(0, 160),
    message: redactSensitiveText(normalizeMessage(error?.message || 'Unexpected error')).slice(
      0,
      MAX_STRING_LENGTH,
    ),
  };
}

function runtimeVersion() {
  return process.env.APP_VERSION?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'development';
}

function runtimeEnvironment() {
  const candidate = process.env.MOVENTRA_ENV?.trim()
    || process.env.VERCEL_TARGET_ENV?.trim()
    || process.env.VERCEL_ENV?.trim()
    || process.env.NODE_ENV?.trim();
  return candidate || 'development';
}

function normalizeComponent(component) {
  if (typeof component !== 'string' || !component.trim()) {
    return 'application';
  }
  return component.trim().slice(0, 120);
}

function normalizeMessage(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (message === null || message === undefined) {
    return '';
  }
  return String(message);
}
