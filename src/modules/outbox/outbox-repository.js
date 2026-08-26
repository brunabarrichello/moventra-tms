export class PostgresOutboxRepository {
  constructor({ query }) {
    if (typeof query !== 'function') {
      throw new TypeError('PostgresOutboxRepository requires a query function');
    }
    this.query = query;
  }

  async append({
    tenantId,
    aggregateType,
    aggregateId,
    eventType,
    schemaVersion,
    payload,
    metadata,
    dedupeKey,
    availableDelayMs,
  }) {
    const result = await this.query(
      `INSERT INTO outbox.events (
         tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
         payload, metadata, dedupe_key, available_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::jsonb, $7::jsonb, $8,
         clock_timestamp() + ($9::bigint * interval '1 millisecond')
       )
       RETURNING
         id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
         payload, metadata, dedupe_key, occurred_at, available_at, published_at,
         attempt_count, last_attempt_at, claim_token, claimed_at, created_at`,
      [
        tenantId,
        aggregateType,
        aggregateId,
        eventType,
        schemaVersion,
        JSON.stringify(payload),
        JSON.stringify(metadata),
        dedupeKey,
        availableDelayMs,
      ],
    );

    if (result.rowCount !== 1) {
      throw repositoryError('MVT_OUTBOX_APPEND_FAILED', 'Outbox event was not persisted');
    }
    return mapEvent(result.rows[0]);
  }

  async findById({ id }) {
    const result = await this.query(
      `SELECT
         id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
         payload, metadata, dedupe_key, occurred_at, available_at, published_at,
         attempt_count, last_attempt_at, claim_token, claimed_at, created_at
       FROM outbox.events
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    return result.rowCount === 1 ? mapEvent(result.rows[0]) : null;
  }

  async claimBatch({ limit, claimTtlMs, claimToken }) {
    const result = await this.query(
      `WITH eligible AS (
         SELECT id
           FROM outbox.events
          WHERE published_at IS NULL
            AND available_at <= clock_timestamp()
            AND (
              claim_token IS NULL
              OR claimed_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
            )
          ORDER BY available_at, occurred_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE outbox.events AS event
          SET claim_token = $3,
              claimed_at = clock_timestamp(),
              attempt_count = event.attempt_count + 1,
              last_attempt_at = clock_timestamp()
         FROM eligible
        WHERE event.id = eligible.id
       RETURNING
         event.id, event.tenant_id, event.aggregate_type, event.aggregate_id,
         event.event_type, event.schema_version, event.payload, event.metadata,
         event.dedupe_key, event.occurred_at, event.available_at, event.published_at,
         event.attempt_count, event.last_attempt_at, event.claim_token,
         event.claimed_at, event.created_at`,
      [claimTtlMs, limit, claimToken],
    );

    return Object.freeze(result.rows.map(mapEvent));
  }

  async markPublished({ eventId, claimToken }) {
    const result = await this.query(
      `UPDATE outbox.events
          SET published_at = clock_timestamp(),
              claim_token = NULL,
              claimed_at = NULL
        WHERE id = $1
          AND claim_token = $2
          AND published_at IS NULL
       RETURNING
         id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
         payload, metadata, dedupe_key, occurred_at, available_at, published_at,
         attempt_count, last_attempt_at, claim_token, claimed_at, created_at`,
      [eventId, claimToken],
    );

    return result.rowCount === 1 ? mapEvent(result.rows[0]) : null;
  }
}

function mapEvent(row) {
  if (!row || typeof row !== 'object') {
    throw repositoryError('MVT_OUTBOX_RECORD_INVALID', 'Outbox event record is invalid');
  }
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    payload: freezePlainObject(row.payload),
    metadata: freezePlainObject(row.metadata),
    dedupeKey: row.dedupe_key,
    occurredAt: normalizeDate(row.occurred_at),
    availableAt: normalizeDate(row.available_at),
    publishedAt: normalizeDate(row.published_at),
    attemptCount: Number(row.attempt_count),
    lastAttemptAt: normalizeDate(row.last_attempt_at),
    claimToken: row.claim_token,
    claimedAt: normalizeDate(row.claimed_at),
    createdAt: normalizeDate(row.created_at),
  });
}

function normalizeDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError('MVT_OUTBOX_RECORD_INVALID', 'Outbox event timestamp is invalid');
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
