const JOB_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/;
const SCHEDULE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEYS = new Set([
  'authorization', 'cookie', 'password', 'secret', 'token', 'accesstoken',
  'refreshtoken', 'databaseurl', 'brokerurl', 'connectionstring', 'dsn',
]);

export const JOB_SCOPES = Object.freeze(['tenant', 'system']);
export const JOB_STATUSES = Object.freeze([
  'scheduled', 'running', 'retry_scheduled', 'succeeded', 'failed_terminal', 'cancelled',
]);

export function normalizeJobType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (type.length < 3 || type.length > 160 || !JOB_TYPE_PATTERN.test(type)) {
    throw jobContractError('MVT_JOB_TYPE_INVALID', 'Job type is invalid');
  }
  return type;
}

export function normalizeJobScheduleInput(input, { defaultMaxAttempts = 10, now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw jobContractError('MVT_JOB_INPUT_INVALID', 'Job schedule input is required');
  }

  const scope = input.scope === 'system' ? 'system' : input.scope === 'tenant' ? 'tenant' : null;
  if (!scope) {
    throw jobContractError('MVT_JOB_SCOPE_INVALID', 'Job scope must be tenant or system');
  }

  const tenantId = input.tenantId ?? null;
  if (scope === 'tenant' && !isUuid(tenantId)) {
    throw jobContractError('MVT_JOB_TENANT_INVALID', 'Tenant-scoped job requires a valid tenantId');
  }
  if (scope === 'system' && tenantId !== null && tenantId !== undefined) {
    throw jobContractError('MVT_JOB_TENANT_INVALID', 'System-scoped job cannot carry tenantId');
  }

  const payload = normalizeJsonObject(input.payload ?? {}, 'payload', 65536);
  const metadata = normalizeJsonObject(input.metadata ?? {}, 'metadata', 8192);
  const availableAt = normalizeTimestamp(input.availableAt ?? now, 'availableAt');
  const maxAttempts = boundedInteger(input.maxAttempts ?? defaultMaxAttempts, 1, 100, 'maxAttempts');
  const priority = boundedInteger(input.priority ?? 0, -100, 100, 'priority');
  const schemaVersion = boundedInteger(input.schemaVersion ?? 1, 1, 32767, 'schemaVersion');
  const scheduleKey = normalizeScheduleKey(input.scheduleKey ?? null);
  const recurrenceIntervalMs = input.recurrenceIntervalMs === null || input.recurrenceIntervalMs === undefined
    ? null
    : boundedInteger(input.recurrenceIntervalMs, 1000, 86400000, 'recurrenceIntervalMs');

  return deepFreeze({
    tenantId: scope === 'tenant' ? tenantId : null,
    scope,
    jobType: normalizeJobType(input.jobType),
    schemaVersion,
    payload,
    metadata,
    priority,
    availableAt,
    maxAttempts,
    scheduleKey,
    recurrenceIntervalMs,
  });
}

export function normalizeJobId(value, name = 'jobId') {
  if (!isUuid(value)) {
    throw jobContractError('MVT_JOB_IDENTIFIER_INVALID', `${name} is invalid`);
  }
  return value.toLowerCase();
}

export function normalizeLeaseToken(value) {
  return normalizeJobId(value, 'leaseToken');
}

function normalizeScheduleKey(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const key = typeof value === 'string' ? value.trim() : '';
  if (!SCHEDULE_KEY_PATTERN.test(key)) {
    throw jobContractError('MVT_JOB_SCHEDULE_KEY_INVALID', 'Job schedule key is invalid');
  }
  return key;
}

function normalizeJsonObject(value, name, maxBytes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw jobContractError('MVT_JOB_PAYLOAD_INVALID', `Job ${name} must be a JSON object`);
  }
  inspectJson(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw jobContractError('MVT_JOB_PAYLOAD_TOO_LARGE', `Job ${name} exceeds size limit`);
  }
  return deepFreeze(JSON.parse(serialized));
}

function inspectJson(value, depth) {
  if (depth > 16) {
    throw jobContractError('MVT_JOB_PAYLOAD_INVALID', 'Job JSON nesting is too deep');
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      inspectJson(item, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      throw jobContractError('MVT_JOB_SENSITIVE_DATA_REJECTED', 'Sensitive job payload field is forbidden');
    }
    inspectJson(child, depth + 1);
  }
}

function normalizeTimestamp(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw jobContractError('MVT_JOB_TIMESTAMP_INVALID', `${name} is invalid`);
  }
  return date.toISOString();
}

function boundedInteger(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw jobContractError('MVT_JOB_SETTING_INVALID', `${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function jobContractError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
