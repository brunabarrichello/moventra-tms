const TABLE_BY_SCOPE = Object.freeze({
  tenant: 'jobs.jobs',
  system: 'jobs.system_jobs',
});

export class PostgresJobReprocessRepository {
  constructor({ query, scope = 'tenant' } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('PostgresJobReprocessRepository requires a query function');
    }
    if (!Object.hasOwn(TABLE_BY_SCOPE, scope)) {
      throw new TypeError('PostgresJobReprocessRepository scope must be tenant or system');
    }
    this.query = query;
    this.scope = scope;
    this.table = TABLE_BY_SCOPE[scope];
  }

  async findById({ id }) {
    const result = await this.query(
      `SELECT * FROM ${this.table} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rowCount === 1 ? mapJob(result.rows[0], this.scope) : null;
  }

  async rescheduleFromTerminal({ sourceJobId, dlqEntryId }) {
    const result = this.scope === 'tenant'
      ? await this.query(
        `INSERT INTO jobs.jobs (
           tenant_id, job_type, schema_version, payload, metadata,
           priority, available_at, max_attempts, schedule_key, recurrence_interval_ms,
           reprocessed_from_job_id, reprocessed_from_dlq_entry_id
         )
         SELECT source.tenant_id, source.job_type, source.schema_version, source.payload, source.metadata,
                source.priority, clock_timestamp(), source.max_attempts, source.schedule_key,
                source.recurrence_interval_ms, source.id, $2
           FROM jobs.jobs AS source
          WHERE source.id = $1
            AND source.status = 'failed_terminal'
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [sourceJobId, dlqEntryId],
      )
      : await this.query(
        `INSERT INTO jobs.system_jobs (
           job_type, schema_version, payload, metadata,
           priority, available_at, max_attempts, schedule_key, recurrence_interval_ms,
           reprocessed_from_job_id, reprocessed_from_dlq_entry_id
         )
         SELECT source.job_type, source.schema_version, source.payload, source.metadata,
                source.priority, clock_timestamp(), source.max_attempts, source.schedule_key,
                source.recurrence_interval_ms, source.id, $2
           FROM jobs.system_jobs AS source
          WHERE source.id = $1
            AND source.status = 'failed_terminal'
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [sourceJobId, dlqEntryId],
      );

    if (result.rowCount === 1) {
      return mapJob(result.rows[0], this.scope);
    }

    // An ambiguous retry after the INSERT committed must return the same logical child.
    // The unique lineage index makes this lookup the idempotency recovery path.
    const existing = await this.query(
      `SELECT * FROM ${this.table}
        WHERE reprocessed_from_dlq_entry_id = $1
        LIMIT 1`,
      [dlqEntryId],
    );
    return existing.rowCount === 1 ? mapJob(existing.rows[0], this.scope) : null;
  }
}

function mapJob(row, scope) {
  return Object.freeze({
    id: row.id,
    tenantId: scope === 'tenant' ? row.tenant_id : null,
    scope,
    jobType: row.job_type,
    schemaVersion: Number(row.schema_version),
    payload: freezeJson(row.payload),
    metadata: freezeJson(row.metadata),
    status: row.status,
    priority: Number(row.priority),
    availableAt: iso(row.available_at),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    leaseToken: row.lease_token,
    leasedAt: iso(row.leased_at),
    leaseExpiresAt: iso(row.lease_expires_at),
    lastHeartbeatAt: iso(row.last_heartbeat_at),
    lastErrorCode: row.last_error_code,
    lastErrorClass: row.last_error_class,
    scheduleKey: row.schedule_key,
    recurrenceIntervalMs: row.recurrence_interval_ms === null ? null : Number(row.recurrence_interval_ms),
    reprocessedFromJobId: row.reprocessed_from_job_id,
    reprocessedFromDlqEntryId: row.reprocessed_from_dlq_entry_id,
    lastCompletedAt: iso(row.last_completed_at),
    completedAt: iso(row.completed_at),
    cancelledAt: scope === 'tenant' ? iso(row.cancelled_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function freezeJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({});
  }
  return Object.freeze({ ...value });
}

function iso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    const error = new Error('Job timestamp is invalid');
    error.code = 'MVT_JOB_RECORD_INVALID';
    throw error;
  }
  return date.toISOString();
}
