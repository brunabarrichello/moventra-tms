const OUTBOX_CONTRACT_BRAND = Symbol('moventra.outbox.contract');
const AGGREGATE_TYPE = /^[a-z][a-z0-9_]{1,63}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEDUPE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 8 * 1024;
const MAX_AVAILABLE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
const METADATA_KEYS = new Set(['correlationId', 'causationId', 'actorType', 'schemaVersion']);
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
  'idempotencykey',
]);

export function defineOutboxEventContract({ aggregateType, eventType, schemaVersion }) {
  const normalizedAggregateType = normalizeAggregateType(aggregateType);
  const normalizedEventType = normalizeEventType(eventType);
  const normalizedSchemaVersion = normalizeSchemaVersion(schemaVersion);

  return Object.freeze({
    [OUTBOX_CONTRACT_BRAND]: true,
    aggregateType: normalizedAggregateType,
    eventType: normalizedEventType,
    schemaVersion: normalizedSchemaVersion,
  });
}

export function normalizeOutboxAppendInput(input, tenantId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw outboxContractError('MVT_OUTBOX_CONTRACT_INVALID', 'Outbox append input must be an object');
  }
  if (!UUID.test(String(tenantId ?? ''))) {
    throw outboxContractError('MVT_OUTBOX_TENANT_INVALID', 'Outbox tenant context must be a canonical UUID');
  }
  if (!input.contract || input.contract[OUTBOX_CONTRACT_BRAND] !== true) {
    throw outboxContractError(
      'MVT_OUTBOX_CONTRACT_UNREGISTERED',
      'Outbox event must use an application-defined event contract',
    );
  }

  const contract = input.contract;
  const aggregateId = normalizeOptionalUuid(input.aggregateId, 'aggregateId');
  const payload = normalizeJsonObject(input.payload, MAX_PAYLOAD_BYTES, 'payload', true);
  const metadata = normalizeMetadata(input.metadata, contract.schemaVersion);
  const dedupeKey = normalizeDedupeKey(input.dedupeKey);
  const availableDelayMs = normalizeAvailableDelay(input.availableDelayMs);

  return Object.freeze({
    tenantId: String(tenantId).toLowerCase(),
    aggregateType: contract.aggregateType,
    aggregateId,
    eventType: contract.eventType,
    schemaVersion: contract.schemaVersion,
    payload,
    metadata,
    dedupeKey,
    availableDelayMs,
  });
}

export function normalizeClaimIdentifier(value, fieldName) {
  if (!UUID.test(String(value ?? ''))) {
    throw outboxContractError('MVT_OUTBOX_CLAIM_INVALID', `${fieldName} must be a canonical UUID`);
  }
  return String(value).toLowerCase();
}

function normalizeAggregateType(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!AGGREGATE_TYPE.test(candidate)) {
    throw outboxContractError('MVT_OUTBOX_AGGREGATE_TYPE_INVALID', 'Invalid outbox aggregate type');
  }
  return candidate;
}

function normalizeEventType(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EVENT_TYPE.test(candidate) || candidate.length > 160) {
    throw outboxContractError('MVT_OUTBOX_EVENT_TYPE_INVALID', 'Invalid outbox event type');
  }
  return candidate;
}

function normalizeSchemaVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw outboxContractError('MVT_OUTBOX_SCHEMA_VERSION_INVALID', 'Invalid outbox schema version');
  }
  return version;
}

function normalizeOptionalUuid(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeClaimIdentifier(value, fieldName);
}

function normalizeDedupeKey(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !DEDUPE_KEY.test(value.trim())) {
    throw outboxContractError('MVT_OUTBOX_DEDUPE_KEY_INVALID', 'Invalid outbox dedupe key');
  }
  return value.trim();
}

function normalizeAvailableDelay(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const delay = Number(value);
  if (!Number.isInteger(delay) || delay < 0 || delay > MAX_AVAILABLE_DELAY_MS) {
    throw outboxContractError('MVT_OUTBOX_AVAILABLE_DELAY_INVALID', 'Invalid outbox available delay');
  }
  return delay;
}

function normalizeMetadata(value, schemaVersion) {
  const metadata = normalizeJsonObject(value ?? {}, MAX_METADATA_BYTES, 'metadata', false);
  for (const key of Object.keys(metadata)) {
    if (!METADATA_KEYS.has(key)) {
      throw outboxContractError('MVT_OUTBOX_METADATA_INVALID', 'Outbox metadata contains a non-allowlisted key');
    }
  }

  if (metadata.schemaVersion !== undefined && Number(metadata.schemaVersion) !== schemaVersion) {
    throw outboxContractError('MVT_OUTBOX_METADATA_INVALID', 'Outbox metadata schemaVersion must match the event contract');
  }

  return Object.freeze({ ...metadata, schemaVersion });
}

function normalizeJsonObject(value, maxBytes, fieldName, inspectSensitiveKeys) {
  if (!isPlainObject(value)) {
    throw outboxContractError('MVT_OUTBOX_PAYLOAD_INVALID', `Outbox ${fieldName} must be a JSON object`);
  }
  if (inspectSensitiveKeys) {
    assertNoForbiddenKeys(value, 0);
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw outboxContractError('MVT_OUTBOX_PAYLOAD_INVALID', `Outbox ${fieldName} must be JSON serializable`);
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw outboxContractError('MVT_OUTBOX_PAYLOAD_TOO_LARGE', `Outbox ${fieldName} exceeds the allowed size`);
  }

  const cloned = JSON.parse(serialized);
  if (!isPlainObject(cloned)) {
    throw outboxContractError('MVT_OUTBOX_PAYLOAD_INVALID', `Outbox ${fieldName} must remain an object after serialization`);
  }
  return Object.freeze(cloned);
}

function assertNoForbiddenKeys(value, depth) {
  if (depth > 16) {
    throw outboxContractError('MVT_OUTBOX_PAYLOAD_INVALID', 'Outbox payload nesting is too deep');
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
    if (isForbiddenKey(key)) {
      throw outboxContractError('MVT_OUTBOX_PAYLOAD_SENSITIVE', 'Outbox payload contains a forbidden sensitive field');
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenKeys(nested, depth + 1);
    }
  }
}

function isForbiddenKey(value) {
  const normalized = String(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return FORBIDDEN_KEYS.has(normalized);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function outboxContractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
