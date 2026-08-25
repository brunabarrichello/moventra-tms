const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/;
const SAFE_CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_DEPTH = 16;
const TOP_LEVEL_KEYS = new Set([
  'messageId',
  'eventId',
  'tenantId',
  'eventType',
  'schemaVersion',
  'occurredAt',
  'correlationId',
  'causationId',
  'payload',
]);
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'password',
  'passwd',
  'secret',
  'token',
  'tokens',
  'accesstoken',
  'refreshtoken',
  'dsn',
  'databaseurl',
  'connectionstring',
  'idempotencykey',
]);

export function createMessageEnvelope(input) {
  if (!isPlainObject(input)) {
    throw envelopeError('MVT_MESSAGING_ENVELOPE_INVALID', 'Messaging envelope must be an object');
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw envelopeError('MVT_MESSAGING_ENVELOPE_INVALID', 'Messaging envelope contains an unsupported field');
    }
  }

  const envelope = {
    messageId: normalizeUuid(input.messageId, 'messageId'),
    eventId: normalizeUuid(input.eventId, 'eventId'),
    tenantId: normalizeUuid(input.tenantId, 'tenantId'),
    eventType: normalizeEventType(input.eventType),
    schemaVersion: normalizeSchemaVersion(input.schemaVersion),
    occurredAt: normalizeOccurredAt(input.occurredAt),
    correlationId: normalizeOptionalContextId(input.correlationId, 'correlationId'),
    causationId: normalizeOptionalContextId(input.causationId, 'causationId'),
    payload: normalizePayload(input.payload),
  };

  return deepFreeze(envelope);
}

export function parseMessageEnvelope(value) {
  let input = value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    input = Buffer.from(value).toString('utf8');
  }
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_PAYLOAD_BYTES + 4096) {
      throw envelopeError('MVT_MESSAGING_ENVELOPE_TOO_LARGE', 'Messaging envelope exceeds the allowed size');
    }
    try {
      input = JSON.parse(input);
    } catch {
      throw envelopeError('MVT_MESSAGING_ENVELOPE_INVALID', 'Messaging envelope must contain valid JSON');
    }
  }
  return createMessageEnvelope(input);
}

export function serializeMessageEnvelope(input) {
  const envelope = createMessageEnvelope(input);
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES + 4096) {
    throw envelopeError('MVT_MESSAGING_ENVELOPE_TOO_LARGE', 'Messaging envelope exceeds the allowed size');
  }
  return Buffer.from(serialized, 'utf8');
}

export function normalizeMessageRoutingKey(value) {
  return normalizeEventType(value);
}

function normalizeUuid(value, fieldName) {
  const candidate = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(candidate)) {
    throw envelopeError('MVT_MESSAGING_ENVELOPE_INVALID', `${fieldName} must be a canonical UUID`);
  }
  return candidate;
}

function normalizeEventType(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EVENT_TYPE.test(candidate) || candidate.length > 160) {
    throw envelopeError('MVT_MESSAGING_EVENT_TYPE_INVALID', 'Messaging eventType is invalid');
  }
  return candidate;
}

function normalizeSchemaVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw envelopeError('MVT_MESSAGING_SCHEMA_VERSION_INVALID', 'Messaging schemaVersion is invalid');
  }
  return version;
}

function normalizeOccurredAt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw envelopeError('MVT_MESSAGING_OCCURRED_AT_INVALID', 'Messaging occurredAt is required');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw envelopeError('MVT_MESSAGING_OCCURRED_AT_INVALID', 'Messaging occurredAt is invalid');
  }
  return date.toISOString();
}

function normalizeOptionalContextId(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !SAFE_CONTEXT_ID.test(value.trim())) {
    throw envelopeError('MVT_MESSAGING_CONTEXT_INVALID', `${fieldName} is invalid`);
  }
  return value.trim();
}

function normalizePayload(value) {
  if (!isPlainObject(value)) {
    throw envelopeError('MVT_MESSAGING_PAYLOAD_INVALID', 'Messaging payload must be a JSON object');
  }
  assertNoForbiddenKeys(value, 0);

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw envelopeError('MVT_MESSAGING_PAYLOAD_INVALID', 'Messaging payload must be JSON serializable');
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw envelopeError('MVT_MESSAGING_PAYLOAD_TOO_LARGE', 'Messaging payload exceeds the allowed size');
  }
  const cloned = JSON.parse(serialized);
  if (!isPlainObject(cloned)) {
    throw envelopeError('MVT_MESSAGING_PAYLOAD_INVALID', 'Messaging payload must remain an object');
  }
  return cloned;
}

function assertNoForbiddenKeys(value, depth) {
  if (depth > MAX_DEPTH) {
    throw envelopeError('MVT_MESSAGING_PAYLOAD_INVALID', 'Messaging payload nesting is too deep');
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') {
        assertNoForbiddenKeys(item, depth + 1);
      }
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)) {
      throw envelopeError('MVT_MESSAGING_PAYLOAD_SENSITIVE', 'Messaging payload contains a forbidden sensitive field');
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenKeys(nested, depth + 1);
    }
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function envelopeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
