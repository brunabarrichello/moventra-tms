import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requestContextStorage = new AsyncLocalStorage();
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

export function createRequestContext(headers = {}) {
  const requestId = normalizeExternalIdentifier(readHeader(headers, 'x-request-id'));
  const correlationId = normalizeExternalIdentifier(readHeader(headers, 'x-correlation-id'));

  return {
    requestId: requestId ?? randomUUID(),
    correlationId: correlationId ?? requestId ?? randomUUID(),
    traceId: null,
    spanId: null,
  };
}

export function runWithRequestContext(requestContext, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Request context callback must be a function');
  }

  const normalized = normalizeRequestContext(requestContext);
  return requestContextStorage.run(normalized, callback);
}

export function getRequestContext() {
  const context = requestContextStorage.getStore();
  return context ? Object.freeze({ ...context }) : null;
}

export function setActiveTraceContext(traceContext) {
  const active = requestContextStorage.getStore();
  if (!active) {
    return;
  }

  active.traceId = normalizeTraceId(traceContext?.traceId);
  active.spanId = normalizeSpanId(traceContext?.spanId);
}

export function normalizeExternalIdentifier(value) {
  const candidate = firstHeaderValue(value);
  if (!candidate || !EXTERNAL_ID_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

export function normalizeTraceId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return TRACE_ID_PATTERN.test(normalized) && normalized !== '00000000000000000000000000000000'
    ? normalized
    : null;
}

export function normalizeSpanId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SPAN_ID_PATTERN.test(normalized) && normalized !== '0000000000000000' ? normalized : null;
}

function normalizeRequestContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Request context must be an object');
  }

  const requestId = normalizeExternalIdentifier(value.requestId) ?? randomUUID();
  const correlationId = normalizeExternalIdentifier(value.correlationId) ?? requestId;

  return {
    requestId,
    correlationId,
    traceId: normalizeTraceId(value.traceId),
    spanId: normalizeSpanId(value.spanId),
  };
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  if (typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }

  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return firstHeaderValue(value[0]);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}
