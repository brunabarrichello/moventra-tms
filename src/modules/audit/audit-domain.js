const outcomes = new Set(['SUCCESS', 'DENIED', 'FAILED']);
const codePattern = /^[a-z][a-z0-9_.-]{1,127}$/;
const sensitiveKeys = new Set([
  'password', 'passwordhash', 'secret', 'clientsecret', 'token', 'accesstoken',
  'refreshtoken', 'authorization', 'cookie', 'setcookie', 'session', 'sessionid',
  'credential', 'credentials', 'privatekey', 'apikey', 'databaseurl',
]);
const MAX_JSON_BYTES = 65536;
const MAX_DEPTH = 8;

export function normalizeAuditEvent(input) {
  assertRecord(input, 'Audit event');
  const tenantId = normalizeOptionalUuid(input.tenantId, 'Tenant id');
  const actorUserId = normalizeOptionalUuid(input.actorUserId, 'Actor user id');
  const actorMembershipId = normalizeOptionalUuid(input.actorMembershipId, 'Actor membership id');
  const companyId = normalizeOptionalUuid(input.companyId, 'Company id');
  const branchId = normalizeOptionalUuid(input.branchId, 'Branch id');

  if (actorMembershipId && !tenantId) {
    throw auditError('MVT_AUDIT_SCOPE_INVALID', 'Actor Membership requires Tenant context');
  }
  if (companyId && !tenantId) {
    throw auditError('MVT_AUDIT_SCOPE_INVALID', 'Company context requires Tenant context');
  }
  if (branchId && (!tenantId || !companyId)) {
    throw auditError('MVT_AUDIT_SCOPE_INVALID', 'Branch context requires Tenant and Company context');
  }

  const outcome = requireString(input.outcome, 'Outcome').toUpperCase();
  if (!outcomes.has(outcome)) {
    throw auditError('MVT_AUDIT_OUTCOME_INVALID', 'Audit outcome is invalid');
  }

  return Object.freeze({
    tenantId,
    actorUserId,
    actorMembershipId,
    companyId,
    branchId,
    category: normalizeCode(input.category, 'Category', 63),
    action: normalizeCode(input.action, 'Action', 127),
    entityType: normalizeCode(input.entityType, 'Entity type', 127),
    entityId: normalizeOptionalText(input.entityId, 200),
    outcome,
    requestId: normalizeOptionalText(input.requestId, 200),
    correlationId: normalizeOptionalText(input.correlationId, 200),
    reason: normalizeOptionalText(input.reason, 1000),
    beforeData: sanitizeAuditObject(input.beforeData),
    afterData: sanitizeAuditObject(input.afterData),
    metadata: sanitizeAuditObject(input.metadata),
  });
}

export function sanitizeAuditObject(value) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw auditError('MVT_AUDIT_PAYLOAD_INVALID', 'Audit payload must be an object');
  }
  const sanitized = sanitizeValue(value, 0);
  const bytes = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
  if (bytes > MAX_JSON_BYTES) {
    throw auditError('MVT_AUDIT_PAYLOAD_TOO_LARGE', 'Audit payload exceeds 64 KiB');
  }
  return sanitized;
}

function sanitizeValue(value, depth) {
  if (depth > MAX_DEPTH) {
    return '[TRUNCATED]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      output[key] = sensitiveKeys.has(normalizeSensitiveKey(key))
        ? '[REDACTED]'
        : sanitizeValue(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 4000) {
    return `${value.slice(0, 4000)}[TRUNCATED]`;
  }
  if (['string', 'number', 'boolean'].includes(typeof value) || value === null) {
    return value;
  }
  return String(value);
}

function normalizeSensitiveKey(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function normalizeCode(value, label, maximum) {
  const normalized = requireString(value, label).toLowerCase();
  if (normalized.length > maximum || !codePattern.test(normalized)) {
    throw auditError('MVT_AUDIT_CODE_INVALID', `${label} is invalid`);
  }
  return normalized;
}

function normalizeOptionalText(value, maximum) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = requireString(value, 'Optional audit text');
  if (normalized.length > maximum) {
    throw auditError('MVT_AUDIT_TEXT_INVALID', 'Audit text exceeds allowed length');
  }
  return normalized;
}

function normalizeOptionalUuid(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw auditError('MVT_AUDIT_ID_INVALID', `${label} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw auditError('MVT_AUDIT_INPUT_INVALID', `${label} is required`);
  }
  return value.trim();
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw auditError('MVT_AUDIT_INPUT_INVALID', `${label} must be an object`);
  }
}

function auditError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
