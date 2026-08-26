const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CODE_RE = /^[A-Z][A-Z0-9_]{2,159}$/;
const FAILURE_CLASS_RE = /^[a-z][a-z0-9_-]{1,79}$/;

export class SystemDlqIngestionRepository {
  constructor({ query } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('SystemDlqIngestionRepository requires a query function');
    }
    this.query = query;
  }

  async quarantineOutboxMessage({
    eventId,
    failureCode = 'MESSAGING_DEAD_LETTERED',
    failureClass = 'consumer_terminal',
    metadata = {},
    maxReprocessAttempts = 5,
  } = {}) {
    const normalizedEventId = normalizeUuid(eventId);
    const normalizedFailureCode = normalizeFailureCode(failureCode);
    const normalizedFailureClass = normalizeFailureClass(failureClass);
    const normalizedMetadata = normalizeMetadata(metadata);
    const normalizedMaxAttempts = normalizeInteger(maxReprocessAttempts, 1, 25, 'maxReprocessAttempts');

    const result = await this.query(
      `SELECT *
         FROM dlq.quarantine_outbox_message(
           $1::uuid,
           $2::text,
           $3::text,
           $4::jsonb,
           $5::smallint
         )`,
      [
        normalizedEventId,
        normalizedFailureCode,
        normalizedFailureClass,
        JSON.stringify(normalizedMetadata),
        normalizedMaxAttempts,
      ],
    );

    if (result.rowCount === 0) {
      return null;
    }
    if (result.rowCount !== 1) {
      throw repositoryError('MVT_DLQ_INGESTION_RESULT_INVALID', 'DLQ ingestion capability returned an invalid cardinality');
    }

    const row = result.rows[0];
    return Object.freeze({
      id: row.id,
      tenantId: row.tenant_id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      status: row.status,
      version: Number(row.version),
    });
  }
}

function normalizeUuid(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_RE.test(candidate)) {
    throw repositoryError('MVT_DLQ_SOURCE_ID_INVALID', 'DLQ source event id must be a UUID');
  }
  return candidate;
}

function normalizeFailureCode(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!FAILURE_CODE_RE.test(candidate)) {
    throw repositoryError('MVT_DLQ_FAILURE_CODE_INVALID', 'DLQ failure code is invalid');
  }
  return candidate;
}

function normalizeFailureClass(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!FAILURE_CLASS_RE.test(candidate)) {
    throw repositoryError('MVT_DLQ_FAILURE_CLASS_INVALID', 'DLQ failure class is invalid');
  }
  return candidate;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw repositoryError('MVT_DLQ_METADATA_INVALID', 'DLQ ingestion metadata must be an object');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 8192) {
    throw repositoryError('MVT_DLQ_METADATA_INVALID', 'DLQ ingestion metadata is too large');
  }
  return JSON.parse(serialized);
}

function normalizeInteger(value, min, max, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw repositoryError('MVT_DLQ_FIELD_INVALID', `${field} is invalid`);
  }
  return number;
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
