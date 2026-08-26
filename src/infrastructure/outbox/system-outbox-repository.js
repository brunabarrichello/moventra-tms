export class SystemOutboxRepository {
  constructor({ query } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('SystemOutboxRepository requires a query function');
    }
    this.query = query;
  }

  async append() {
    const error = new Error('System Outbox repository cannot append business events');
    error.code = 'MVT_OUTBOX_SYSTEM_APPEND_FORBIDDEN';
    error.retryable = false;
    throw error;
  }

  async claimBatch({ limit, claimTtlMs, claimToken }) {
    const result = await this.query(
      'SELECT * FROM outbox.claim_system_batch($1, $2, $3)',
      [limit, claimTtlMs, claimToken],
    );
    return Object.freeze(result.rows.map(mapEvent));
  }

  async markPublished({ eventId, claimToken }) {
    const result = await this.query(
      'SELECT * FROM outbox.mark_system_published($1, $2)',
      [eventId, claimToken],
    );
    return result.rowCount === 1 ? mapEvent(result.rows[0]) : null;
  }
}

function mapEvent(row) {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    payload: freezeJson(row.payload),
    metadata: freezeJson(row.metadata),
    dedupeKey: row.dedupe_key,
    occurredAt: iso(row.occurred_at),
    availableAt: iso(row.available_at),
    publishedAt: iso(row.published_at),
    attemptCount: Number(row.attempt_count),
    lastAttemptAt: iso(row.last_attempt_at),
    claimToken: row.claim_token,
    claimedAt: iso(row.claimed_at),
    createdAt: iso(row.created_at),
  });
}

function iso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function freezeJson(value) {
  return Object.freeze(value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {});
}
