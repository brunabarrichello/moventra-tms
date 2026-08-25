export class PostgresIdempotencyRepository {
  constructor({ query }) {
    if (typeof query !== 'function') {
      throw new TypeError('PostgresIdempotencyRepository requires a query function');
    }
    this.query = query;
  }

  async claim({
    tenantId,
    operationKey,
    keyHash,
    keyHashVersion,
    fingerprint,
    fingerprintVersion,
    expiresAt,
  }) {
    const inserted = await this.query(
      `INSERT INTO idempotency.records (
         tenant_id,
         operation_key,
         key_hash,
         key_hash_version,
         fingerprint,
         fingerprint_version,
         state,
         expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'PROCESSING', $7)
       ON CONFLICT (tenant_id, operation_key, key_hash) DO NOTHING
       RETURNING
         id, tenant_id, operation_key, key_hash_version,
         fingerprint, fingerprint_version, state,
         response_status, response_media_type, response_body, response_headers,
         created_at, completed_at, expires_at`,
      [
        tenantId,
        operationKey,
        keyHash,
        keyHashVersion,
        fingerprint,
        fingerprintVersion,
        expiresAt,
      ],
    );

    if (inserted.rowCount === 1) {
      return Object.freeze({ acquired: true, record: mapRecord(inserted.rows[0]) });
    }

    const existing = await this.findByKey({ tenantId, operationKey, keyHash });
    if (!existing) {
      throw repositoryError(
        'MVT_IDEMPOTENCY_CLAIM_UNRESOLVED',
        'Idempotency claim conflict could not be resolved',
      );
    }

    return Object.freeze({ acquired: false, record: existing });
  }

  async findByKey({ tenantId, operationKey, keyHash }) {
    const result = await this.query(
      `SELECT
         id, tenant_id, operation_key, key_hash_version,
         fingerprint, fingerprint_version, state,
         response_status, response_media_type, response_body, response_headers,
         created_at, completed_at, expires_at
       FROM idempotency.records
       WHERE tenant_id = $1
         AND operation_key = $2
         AND key_hash = $3`,
      [tenantId, operationKey, keyHash],
    );

    return result.rowCount === 1 ? mapRecord(result.rows[0]) : null;
  }

  async complete({
    tenantId,
    recordId,
    responseStatus,
    responseMediaType,
    responseBody,
    responseHeaders,
  }) {
    const result = await this.query(
      `UPDATE idempotency.records
          SET state = 'COMPLETED',
              response_status = $3,
              response_media_type = $4,
              response_body = $5::jsonb,
              response_headers = $6::jsonb,
              completed_at = clock_timestamp()
        WHERE tenant_id = $1
          AND id = $2
          AND state = 'PROCESSING'
       RETURNING
         id, tenant_id, operation_key, key_hash_version,
         fingerprint, fingerprint_version, state,
         response_status, response_media_type, response_body, response_headers,
         created_at, completed_at, expires_at`,
      [
        tenantId,
        recordId,
        responseStatus,
        responseMediaType,
        JSON.stringify(responseBody ?? null),
        JSON.stringify(responseHeaders ?? {}),
      ],
    );

    if (result.rowCount !== 1) {
      throw repositoryError(
        'MVT_IDEMPOTENCY_COMPLETE_CONFLICT',
        'Idempotency record could not be completed exactly once',
      );
    }

    return mapRecord(result.rows[0]);
  }
}

function mapRecord(row) {
  if (!row || typeof row !== 'object') {
    throw repositoryError('MVT_IDEMPOTENCY_RECORD_INVALID', 'Idempotency record is invalid');
  }

  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    operationKey: row.operation_key,
    keyHashVersion: Number(row.key_hash_version),
    fingerprint: row.fingerprint,
    fingerprintVersion: Number(row.fingerprint_version),
    state: row.state,
    responseStatus: row.response_status === null ? null : Number(row.response_status),
    responseMediaType: row.response_media_type,
    responseBody: row.response_body ?? null,
    responseHeaders: freezePlainObject(row.response_headers),
    createdAt: normalizeDate(row.created_at),
    completedAt: normalizeDate(row.completed_at),
    expiresAt: normalizeDate(row.expires_at),
  });
}

function normalizeDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError('MVT_IDEMPOTENCY_RECORD_INVALID', 'Idempotency timestamp is invalid');
  }
  return date.toISOString();
}

function freezePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({});
  }
  return Object.freeze({ ...value });
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
