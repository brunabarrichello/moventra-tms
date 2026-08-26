const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_SOURCE_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/;
const SYSTEM_SOURCE_TYPE_RE = /^system\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,6}$/;
const FAILURE_CODE_RE = /^[A-Z][A-Z0-9_]{2,159}$/;
const FAILURE_CLASS_RE = /^[a-z][a-z0-9_-]{1,79}$/;
const SENSITIVE_KEY_RE = /(authorization|password|passwd|secret|token|cookie|session|api[_-]?key|private[_-]?key|database[_-]?url|rabbitmq[_-]?url|dsn)/i;

export const DLQ_SOURCE_KINDS = Object.freeze(['message', 'job']);
export const DLQ_STATUSES = Object.freeze([
  'quarantined',
  'reprocess_pending',
  'reprocessing',
  'resolved',
  'discarded',
  'exhausted',
]);

const TRANSITIONS = Object.freeze({
  quarantined: Object.freeze(['reprocess_pending', 'resolved', 'discarded']),
  reprocess_pending: Object.freeze(['reprocessing']),
  reprocessing: Object.freeze(['resolved', 'quarantined', 'exhausted']),
  resolved: Object.freeze([]),
  discarded: Object.freeze([]),
  exhausted: Object.freeze([]),
});

const MESSAGE_SNAPSHOT_KEYS = Object.freeze([
  'messageId',
  'eventId',
  'eventType',
  'schemaVersion',
  'occurredAt',
  'producer',
  'tenantId',
  'payload',
  'metadata',
]);
const JOB_SNAPSHOT_KEYS = Object.freeze([
  'jobId',
  'jobType',
  'schemaVersion',
  'tenantId',
  'payload',
  'metadata',
  'priority',
  'maxAttempts',
]);

export function createDlqEntry(input = {}) {
  const scope = requireEnum(input.scope, ['tenant', 'system'], 'scope');
  const sourceKind = requireEnum(input.sourceKind, DLQ_SOURCE_KINDS, 'sourceKind');
  const sourceId = requireUuid(input.sourceId, 'sourceId');
  const sourceType = requireString(input.sourceType, 'sourceType', 3, 160).toLowerCase();
  const sourceSchemaVersion = requireInteger(input.sourceSchemaVersion ?? 1, 'sourceSchemaVersion', 1, 32767);
  const failureCode = requireString(input.failureCode, 'failureCode', 3, 160).toUpperCase();
  const failureClass = requireString(input.failureClass, 'failureClass', 2, 80).toLowerCase();
  const maxReprocessAttempts = requireInteger(input.maxReprocessAttempts ?? 5, 'maxReprocessAttempts', 1, 25);

  if (scope === 'tenant') {
    requireUuid(input.tenantId, 'tenantId');
    if (!TENANT_SOURCE_TYPE_RE.test(sourceType)) {
      throw contractError('MVT_DLQ_SOURCE_TYPE_INVALID', 'Tenant DLQ sourceType must be a dotted lowercase contract name');
    }
  } else if (!SYSTEM_SOURCE_TYPE_RE.test(sourceType)) {
    throw contractError('MVT_DLQ_SOURCE_TYPE_INVALID', 'System DLQ sourceType must use the system.* namespace');
  }

  if (!FAILURE_CODE_RE.test(failureCode)) {
    throw contractError('MVT_DLQ_FAILURE_CODE_INVALID', 'failureCode must be a stable uppercase error code');
  }
  if (!FAILURE_CLASS_RE.test(failureClass)) {
    throw contractError('MVT_DLQ_FAILURE_CLASS_INVALID', 'failureClass must be a stable lowercase classification');
  }

  const snapshot = buildDlqSnapshot({ sourceKind, source: input.snapshot ?? {} });
  const metadata = sanitizeBoundedObject(input.metadata ?? {}, {
    maxBytes: 8192,
    maxDepth: 5,
    errorCode: 'MVT_DLQ_METADATA_INVALID',
  });

  return Object.freeze({
    scope,
    tenantId: scope === 'tenant' ? input.tenantId : null,
    sourceKind,
    sourceId,
    sourceType,
    sourceSchemaVersion,
    failureCode,
    failureClass,
    snapshot,
    metadata,
    maxReprocessAttempts,
  });
}

export function buildDlqSnapshot({ sourceKind, source } = {}) {
  const kind = requireEnum(sourceKind, DLQ_SOURCE_KINDS, 'sourceKind');
  if (!isPlainObject(source)) {
    throw contractError('MVT_DLQ_SNAPSHOT_INVALID', 'DLQ snapshot source must be an object');
  }

  const keys = kind === 'message' ? MESSAGE_SNAPSHOT_KEYS : JOB_SNAPSHOT_KEYS;
  const allowlisted = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      allowlisted[key] = source[key];
    }
  }

  return sanitizeBoundedObject(allowlisted, {
    maxBytes: 65536,
    maxDepth: 8,
    errorCode: 'MVT_DLQ_SNAPSHOT_INVALID',
  });
}

export function assertDlqTransition(fromStatus, toStatus) {
  const from = requireEnum(fromStatus, DLQ_STATUSES, 'fromStatus');
  const to = requireEnum(toStatus, DLQ_STATUSES, 'toStatus');
  if (!TRANSITIONS[from].includes(to)) {
    throw contractError(
      'MVT_DLQ_TRANSITION_INVALID',
      `DLQ transition ${from} -> ${to} is not allowed`,
    );
  }
  return true;
}

export function computeDlqReprocessDelay({ attempt, baseMs = 1000, maxMs = 300000 } = {}) {
  const normalizedAttempt = requireInteger(attempt, 'attempt', 1, 25);
  const normalizedBase = requireInteger(baseMs, 'baseMs', 100, 60000);
  const normalizedMax = requireInteger(maxMs, 'maxMs', normalizedBase, 3600000);
  const exponent = Math.min(normalizedAttempt - 1, 20);
  return Math.min(normalizedBase * (2 ** exponent), normalizedMax);
}

function sanitizeBoundedObject(value, { maxBytes, maxDepth, errorCode }) {
  if (!isPlainObject(value)) {
    throw contractError(errorCode, 'Expected a JSON object');
  }
  const sanitized = sanitizeValue(value, 0, maxDepth);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw contractError(errorCode, `Object exceeds ${maxBytes} bytes`);
  }
  return deepFreeze(sanitized);
}

function sanitizeValue(value, depth, maxDepth) {
  if (depth > maxDepth) {
    return '[REDACTED_DEPTH]';
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) || typeof value !== 'number' ? value : null;
  }
  if (typeof value === 'string') {
    return value.length <= 4096 ? value : `${value.slice(0, 4096)}[TRUNCATED]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1, maxDepth));
  }
  if (!isPlainObject(value)) {
    return String(value);
  }

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = sanitizeValue(item, depth + 1, maxDepth);
  }
  return output;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw contractError('MVT_DLQ_UUID_INVALID', `${field} must be a UUID`);
  }
  return value.toLowerCase();
}

function requireString(value, field, min, max) {
  if (typeof value !== 'string') {
    throw contractError('MVT_DLQ_FIELD_INVALID', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw contractError('MVT_DLQ_FIELD_INVALID', `${field} length is invalid`);
  }
  return normalized;
}

function requireInteger(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw contractError('MVT_DLQ_FIELD_INVALID', `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw contractError('MVT_DLQ_FIELD_INVALID', `${field} has an unsupported value`);
  }
  return value;
}

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
