const TABLE_BY_SCOPE = Object.freeze({
  tenant: 'jobs.jobs',
  system: 'jobs.system_jobs',
});

export class PostgresJobRepository {
  constructor({ query, scope = 'tenant' } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('PostgresJobRepository requires a query function');
    }
    if (!Object.hasOwn(TABLE_BY_SCOPE, scope)) {
      throw new TypeError('PostgresJobRepository scope must be tenant or system');
    }
    this.query = query;
    this.scope = scope;
    this.table = TABLE_BY_SCOPE[scope];
  }

  async enqueue(job) {
    if (job?.scope !== this.scope) {
      throw repositoryError('MVT_JOB_SCOPE_REPOSITORY_MISMATCH', 'Job scope does not match repository scope');
    }

    const result = this.scope === 'tenant'
      ? await this.query(
        `INSERT INTO jobs.jobs (
           tenant_id, job_type, schema_version, payload, metadata,
           priority, available_at, max_attempts, schedule_key, recurrence_interval_ms
         ) VALUES (
           $1, $2, $3, $4::jsonb, $5::jsonb,
           $6, $7::timestamptz, $8, $9, $10
         )
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          job.tenantId, job.jobType, job.schemaVersion,
          JSON.stringify(job.payload), JSON.stringify(job.metadata), job.priority,
          job.availableAt, job.maxAttempts, job.scheduleKey, job.recurrenceIntervalMs,
        ],
      )
      : await this.query(
        `INSERT INTO jobs.system_jobs (
           job_type, schema_version, payload, metadata,
           priority, available_at, max_attempts, schedule_key, recurrence_interval_ms
         ) VALUES (
           $1, $2, $3::jsonb, $4::jsonb,
           $5, $6::timestamptz, $7, $8, $9
         )
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          job.jobType, job.schemaVersion,
          JSON.stringify(job.payload), JSON.stringify(job.metadata), job.priority,
          job.availableAt, job.maxAttempts, job.scheduleKey, job.recurrenceIntervalMs,
        ],
      );

    if (result.rowCount === 1) {
      return mapJob(result.rows[0], this.scope);
    }
    if (!job.scheduleKey) {
      throw repositoryError('MVT_JOB_ENQUEUE_CONFLICT', 'Job could not be scheduled');
    }

    const existing = this.scope === 'tenant'
      ? await this.query(
        `SELECT * FROM jobs.jobs
          WHERE tenant_id = $1
            AND schedule_key = $2
            AND status IN ('scheduled', 'running', 'retry_scheduled')
          LIMIT 1`,
        [job.tenantId, job.scheduleKey],
      )
      : await this.query(
        `SELECT * FROM jobs.system_jobs
          WHERE schedule_key = $1
            AND status IN ('scheduled', 'running', 'retry_scheduled')
          LIMIT 1`,
        [job.scheduleKey],
      );

    if (existing.rowCount !== 1) {
      throw repositoryError('MVT_JOB_ENQUEUE_CONFLICT', 'Job singleton schedule conflict could not be resolved');
    }
    return mapJob(existing.rows[0], this.scope);
  }

  async reapExpiredExhausted() {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = 'failed_terminal',
              lease_token = NULL,
              leased_at = NULL,
              lease_expires_at = NULL,
              last_heartbeat_at = NULL,
              last_error_code = 'MVT_JOB_LEASE_EXHAUSTED',
              last_error_class = 'lease_expired',
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE status = 'running'
          AND lease_expires_at <= clock_timestamp()
          AND attempt_count >= max_attempts
       RETURNING id`,
    );
    return result.rowCount;
  }

  async claimBatch({ limit, leaseMs, leaseToken }) {
    const result = await this.query(
      `WITH eligible AS (
         SELECT id
           FROM ${this.table}
          WHERE (
              (status IN ('scheduled', 'retry_scheduled') AND available_at <= clock_timestamp())
              OR (status = 'running' AND lease_expires_at <= clock_timestamp())
          )
            AND attempt_count < max_attempts
          ORDER BY priority DESC, available_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE ${this.table} AS job
          SET status = 'running',
              lease_token = $2,
              leased_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
              last_heartbeat_at = clock_timestamp(),
              attempt_count = job.attempt_count + 1,
              updated_at = clock_timestamp()
         FROM eligible
        WHERE job.id = eligible.id
       RETURNING job.*`,
      [limit, leaseToken, leaseMs],
    );
    return Object.freeze(result.rows.map((row) => mapJob(row, this.scope)));
  }

  async heartbeat({ jobId, leaseToken, leaseMs }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
              last_heartbeat_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1
          AND lease_token = $2
          AND status = 'running'
          AND lease_expires_at > clock_timestamp()
       RETURNING id`,
      [jobId, leaseToken, leaseMs],
    );
    return result.rowCount === 1;
  }

  async completeSuccess({ jobId, leaseToken }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = CASE WHEN recurrence_interval_ms IS NULL THEN 'succeeded' ELSE 'scheduled' END,
              available_at = CASE
                WHEN recurrence_interval_ms IS NULL THEN available_at
                ELSE clock_timestamp() + (recurrence_interval_ms * interval '1 millisecond')
              END,
              attempt_count = CASE WHEN recurrence_interval_ms IS NULL THEN attempt_count ELSE 0 END,
              lease_token = NULL,
              leased_at = NULL,
              lease_expires_at = NULL,
              last_heartbeat_at = NULL,
              last_error_code = NULL,
              last_error_class = NULL,
              last_completed_at = clock_timestamp(),
              completed_at = CASE WHEN recurrence_interval_ms IS NULL THEN clock_timestamp() ELSE NULL END,
              updated_at = clock_timestamp()
        WHERE id = $1 AND lease_token = $2 AND status = 'running'
       RETURNING *`,
      [jobId, leaseToken],
    );
    return result.rowCount === 1 ? mapJob(result.rows[0], this.scope) : null;
  }

  async completeFailure({ jobId, leaseToken, retryable, errorCode, errorClass, delayMs }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = CASE
                WHEN $3::boolean AND attempt_count < max_attempts THEN 'retry_scheduled'
                ELSE 'failed_terminal'
              END,
              available_at = CASE
                WHEN $3::boolean AND attempt_count < max_attempts
                  THEN clock_timestamp() + ($6::bigint * interval '1 millisecond')
                ELSE available_at
              END,
              lease_token = NULL,
              leased_at = NULL,
              lease_expires_at = NULL,
              last_heartbeat_at = NULL,
              last_error_code = $4,
              last_error_class = $5,
              completed_at = CASE
                WHEN $3::boolean AND attempt_count < max_attempts THEN NULL
                ELSE clock_timestamp()
              END,
              updated_at = clock_timestamp()
        WHERE id = $1 AND lease_token = $2 AND status = 'running'
       RETURNING *`,
      [jobId, leaseToken, retryable === true, errorCode, errorClass, delayMs],
    );
    return result.rowCount === 1 ? mapJob(result.rows[0], this.scope) : null;
  }

  async cancel({ jobId }) {
    if (this.scope !== 'tenant') {
      throw repositoryError('MVT_JOB_SYSTEM_CANCEL_FORBIDDEN', 'System job cancellation is not a runtime operation');
    }
    const result = await this.query(
      `UPDATE jobs.jobs
          SET status = 'cancelled', cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1 AND status IN ('scheduled', 'retry_scheduled')
       RETURNING *`,
      [jobId],
    );
    return result.rowCount === 1 ? mapJob(result.rows[0], 'tenant') : null;
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
    lastCompletedAt: iso(row.last_completed_at),
    completedAt: iso(row.completed_at),
    cancelledAt: scope === 'tenant' ? iso(row.cancelled_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function iso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError('MVT_JOB_RECORD_INVALID', 'Job timestamp is invalid');
  }
  return date.toISOString();
}

function freezeJson(value) {
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
