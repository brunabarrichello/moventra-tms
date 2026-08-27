const TABLE_BY_SCOPE = Object.freeze({
  tenant: 'dlq.entries',
  system: 'dlq.system_entries',
});

export class PostgresDlqRepository {
  constructor({ query, scope = 'tenant' } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('PostgresDlqRepository requires a query function');
    }
    if (!Object.hasOwn(TABLE_BY_SCOPE, scope)) {
      throw new TypeError('PostgresDlqRepository scope must be tenant or system');
    }
    this.query = query;
    this.scope = scope;
    this.table = TABLE_BY_SCOPE[scope];
  }

  async quarantine(entry) {
    if (entry?.scope !== this.scope) {
      throw repositoryError('MVT_DLQ_SCOPE_REPOSITORY_MISMATCH', 'DLQ scope does not match repository scope');
    }

    const inserted = this.scope === 'tenant'
      ? await this.query(
        `INSERT INTO dlq.entries (
           tenant_id, source_kind, source_id, source_type, source_schema_version,
           failure_code, failure_class, snapshot, metadata, max_reprocess_attempts
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8::jsonb, $9::jsonb, $10
         )
         ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING
         RETURNING *`,
        [
          entry.tenantId, entry.sourceKind, entry.sourceId, entry.sourceType,
          entry.sourceSchemaVersion, entry.failureCode, entry.failureClass,
          JSON.stringify(entry.snapshot), JSON.stringify(entry.metadata), entry.maxReprocessAttempts,
        ],
      )
      : await this.query(
        `INSERT INTO dlq.system_entries (
           source_kind, source_id, source_type, source_schema_version,
           failure_code, failure_class, snapshot, metadata, max_reprocess_attempts
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7::jsonb, $8::jsonb, $9
         )
         ON CONFLICT (source_kind, source_id) DO NOTHING
         RETURNING *`,
        [
          entry.sourceKind, entry.sourceId, entry.sourceType, entry.sourceSchemaVersion,
          entry.failureCode, entry.failureClass, JSON.stringify(entry.snapshot),
          JSON.stringify(entry.metadata), entry.maxReprocessAttempts,
        ],
      );

    if (inserted.rowCount === 1) {
      return mapEntry(inserted.rows[0], this.scope);
    }

    const existing = this.scope === 'tenant'
      ? await this.query(
        `SELECT * FROM dlq.entries
          WHERE tenant_id = $1 AND source_kind = $2 AND source_id = $3
          LIMIT 1`,
        [entry.tenantId, entry.sourceKind, entry.sourceId],
      )
      : await this.query(
        `SELECT * FROM dlq.system_entries
          WHERE source_kind = $1 AND source_id = $2
          LIMIT 1`,
        [entry.sourceKind, entry.sourceId],
      );

    if (existing.rowCount !== 1) {
      throw repositoryError('MVT_DLQ_QUARANTINE_CONFLICT', 'DLQ dedupe conflict could not be resolved');
    }
    return mapEntry(existing.rows[0], this.scope);
  }

  async findById({ id }) {
    const result = await this.query(
      `SELECT * FROM ${this.table} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rowCount === 1 ? mapEntry(result.rows[0], this.scope) : null;
  }

  async list({ status = null, sourceKind = null, limit = 50, before = null, beforeId = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    if ((before === null) !== (beforeId === null)) {
      throw repositoryError('MVT_DLQ_CURSOR_INVALID', 'DLQ keyset cursor requires timestamp and id together');
    }
    const result = await this.query(
      `SELECT *
         FROM ${this.table}
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR source_kind = $2)
          AND (
            $3::timestamptz IS NULL
            OR quarantined_at < $3::timestamptz
            OR (quarantined_at = $3::timestamptz AND id < $4::uuid)
          )
        ORDER BY quarantined_at DESC, id DESC
        LIMIT $5`,
      [status, sourceKind, before, beforeId, boundedLimit],
    );
    return Object.freeze(result.rows.map((row) => mapEntry(row, this.scope)));
  }

  async requestReprocess({ id, expectedVersion, nextReprocessAt = null }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = 'reprocess_pending',
              next_reprocess_at = COALESCE($3::timestamptz, clock_timestamp()),
              version = version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1
          AND version = $2
          AND status = 'quarantined'
          AND reprocess_count < max_reprocess_attempts
          AND (next_reprocess_at IS NULL OR next_reprocess_at <= clock_timestamp())
       RETURNING *`,
      [id, expectedVersion, nextReprocessAt],
    );
    return result.rowCount === 1 ? mapEntry(result.rows[0], this.scope) : null;
  }

  async claimReprocess({ id, claimToken, claimTtlMs }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = 'reprocessing',
              reprocess_count = reprocess_count + 1,
              reprocess_claim_token = $2,
              reprocess_claimed_at = clock_timestamp(),
              reprocess_claim_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
              last_reprocess_at = clock_timestamp(),
              next_reprocess_at = NULL,
              version = version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1
          AND reprocess_count < max_reprocess_attempts
          AND (
            (status = 'reprocess_pending' AND next_reprocess_at <= clock_timestamp())
            OR (status = 'reprocessing' AND reprocess_claim_expires_at <= clock_timestamp())
          )
       RETURNING *`,
      [id, claimToken, claimTtlMs],
    );
    return result.rowCount === 1 ? mapEntry(result.rows[0], this.scope) : null;
  }

  async completeReprocess({ id, claimToken, resolutionCode = 'reprocessed' }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = 'resolved',
              reprocess_claim_token = NULL,
              reprocess_claimed_at = NULL,
              reprocess_claim_expires_at = NULL,
              resolved_at = clock_timestamp(),
              resolution_code = $3,
              version = version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1
          AND reprocess_claim_token = $2
          AND status = 'reprocessing'
          AND reprocess_claim_expires_at > clock_timestamp()
       RETURNING *`,
      [id, claimToken, resolutionCode],
    );
    return result.rowCount === 1 ? mapEntry(result.rows[0], this.scope) : null;
  }

  async failReprocess({ id, claimToken, failureCode, nextReprocessAt = null }) {
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = CASE
                WHEN reprocess_count >= max_reprocess_attempts THEN 'exhausted'
                ELSE 'quarantined'
              END,
              reprocess_claim_token = NULL,
              reprocess_claimed_at = NULL,
              reprocess_claim_expires_at = NULL,
              next_reprocess_at = CASE
                WHEN reprocess_count >= max_reprocess_attempts THEN NULL
                ELSE $4::timestamptz
              END,
              last_failure_code = $3,
              version = version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1
          AND reprocess_claim_token = $2
          AND status = 'reprocessing'
       RETURNING *`,
      [id, claimToken, failureCode, nextReprocessAt],
    );
    return result.rowCount === 1 ? mapEntry(result.rows[0], this.scope) : null;
  }

  async resolve({ id, expectedVersion, actorId = null, resolutionCode = 'resolved_by_operator' }) {
    return this.#terminalDecision({ id, expectedVersion, actorId, status: 'resolved', resolutionCode });
  }

  async discard({ id, expectedVersion, actorId = null, resolutionCode = 'discarded_by_operator' }) {
    return this.#terminalDecision({ id, expectedVersion, actorId, status: 'discarded', resolutionCode });
  }

  async #terminalDecision({ id, expectedVersion, actorId, status, resolutionCode }) {
    const actorColumn = this.scope === 'tenant' ? 'resolved_by_membership_id' : 'resolved_by_user_id';
    const result = await this.query(
      `UPDATE ${this.table}
          SET status = $3,
              resolved_at = clock_timestamp(),
              ${actorColumn} = $4,
              resolution_code = $5,
              next_reprocess_at = NULL,
              version = version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1
          AND version = $2
          AND status = 'quarantined'
       RETURNING *`,
      [id, expectedVersion, status, actorId, resolutionCode],
    );
    return result.rowCount === 1 ? mapEntry(result.rows[0], this.scope) : null;
  }
}

function mapEntry(row, scope) {
  return Object.freeze({
    id: row.id,
    scope,
    tenantId: scope === 'tenant' ? row.tenant_id : null,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourceSchemaVersion: Number(row.source_schema_version),
    failureCode: row.failure_code,
    failureClass: row.failure_class,
    snapshot: freezeJson(row.snapshot),
    metadata: freezeJson(row.metadata),
    status: row.status,
    quarantinedAt: iso(row.quarantined_at),
    reprocessCount: Number(row.reprocess_count),
    maxReprocessAttempts: Number(row.max_reprocess_attempts),
    nextReprocessAt: iso(row.next_reprocess_at),
    reprocessClaimToken: row.reprocess_claim_token,
    reprocessClaimedAt: iso(row.reprocess_claimed_at),
    reprocessClaimExpiresAt: iso(row.reprocess_claim_expires_at),
    lastReprocessAt: iso(row.last_reprocess_at),
    lastFailureCode: row.last_failure_code,
    resolvedAt: iso(row.resolved_at),
    resolvedByActorId: scope === 'tenant' ? row.resolved_by_membership_id : row.resolved_by_user_id,
    resolutionCode: row.resolution_code,
    version: Number(row.version),
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
    throw repositoryError('MVT_DLQ_RECORD_INVALID', 'DLQ timestamp is invalid');
  }
  return date.toISOString();
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
