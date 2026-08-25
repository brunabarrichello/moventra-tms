import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const TENANT_ID = '01990232-0000-7000-8000-000000000001';
const EVENT_IDS = [
  '01990232-0000-7000-8000-000000000101',
  '01990232-0000-7000-8000-000000000102',
  '01990232-0000-7000-8000-000000000103',
  '01990232-0000-7000-8000-000000000104',
];
const EXPIRED_EVENT_ID = '01990232-0000-7000-8000-000000000105';
const CLAIM_ONE = '01990232-0000-7000-8000-000000000201';
const CLAIM_TWO = '01990232-0000-7000-8000-000000000202';
const CLAIM_RECLAIM = '01990232-0000-7000-8000-000000000203';
const OLD_CLAIM = '01990232-0000-7000-8000-000000000204';
const PROBE_TABLE = 'public.moventra_outbox_atomic_probe';
const IDEMPOTENCY_KEY_HASH = 'e'.repeat(64);
const IDEMPOTENCY_FINGERPRINT = 'f'.repeat(64);
const IDEMPOTENCY_OPERATION = 'validation.outbox.idempotency';

const admin = new Client();
const first = new Client();
const second = new Client();

await Promise.all([admin.connect(), first.connect(), second.connect()]);

try {
  await prepareFixture();
  await validateDisjointConcurrentClaims();
  await validateExpiredClaimAndPublishedExclusion();
  await validateAtomicCommitAndRollback();
  await validateIdempotentReplayDoesNotDuplicateOutbox();
  process.stdout.write('Transactional Outbox PostgreSQL contract passed.\n');
} finally {
  await Promise.allSettled([rollbackQuietly(first), rollbackQuietly(second)]);
  await cleanupFixture();
  await Promise.allSettled([admin.end(), first.end(), second.end()]);
}

async function prepareFixture() {
  await admin.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  await admin.query('DELETE FROM outbox.events WHERE tenant_id = $1', [TENANT_ID]);
  await admin.query('DELETE FROM idempotency.records WHERE tenant_id = $1', [TENANT_ID]);
  await admin.query('DELETE FROM audit.audit_events WHERE tenant_id = $1', [TENANT_ID]);
  await admin.query('DELETE FROM organization.tenants WHERE id = $1', [TENANT_ID]);
  await admin.query(
    `INSERT INTO organization.tenants (
       id, code, display_name, status, default_timezone, default_currency
     ) VALUES ($1, 'outbox-concurrency-ci', 'Outbox Concurrency CI', 'ACTIVE', 'UTC', 'USD')`,
    [TENANT_ID],
  );
  await admin.query(
    `CREATE TABLE ${PROBE_TABLE} (
       id INTEGER PRIMARY KEY,
       note TEXT NOT NULL
     )`,
  );

  for (const [index, eventId] of EVENT_IDS.entries()) {
    await admin.query(
      `INSERT INTO outbox.events (
         id, tenant_id, aggregate_type, event_type, schema_version, payload, metadata
       ) VALUES ($1, $2, 'freight', 'freight.created', 1, $3::jsonb, '{}'::jsonb)`,
      [eventId, TENANT_ID, JSON.stringify({ sequence: index + 1 })],
    );
  }

  await admin.query(
    `INSERT INTO outbox.events (
       id, tenant_id, aggregate_type, event_type, schema_version, payload, metadata,
       occurred_at, available_at, attempt_count, last_attempt_at, claim_token, claimed_at
     ) VALUES (
       $1, $2, 'freight', 'freight.created', 1, '{"expired":true}'::jsonb, '{}'::jsonb,
       clock_timestamp() - interval '10 minutes',
       clock_timestamp() - interval '10 minutes',
       1,
       clock_timestamp() - interval '5 minutes',
       $3,
       clock_timestamp() - interval '5 minutes'
     )`,
    [EXPIRED_EVENT_ID, TENANT_ID, OLD_CLAIM],
  );
}

async function validateDisjointConcurrentClaims() {
  await beginTenant(first);
  const firstIds = await claim(first, CLAIM_ONE, 2, 60_000);
  assert.equal(firstIds.length, 2, 'first claimer must claim two events');

  await beginTenant(second);
  const secondIds = await claim(second, CLAIM_TWO, 2, 60_000);
  assert.equal(secondIds.length, 2, 'second claimer must claim two different events');

  const overlap = firstIds.filter((id) => secondIds.includes(id));
  assert.deepEqual(overlap, [], 'SKIP LOCKED claims must be disjoint');

  await first.query('COMMIT');
  await second.query('COMMIT');
}

async function validateExpiredClaimAndPublishedExclusion() {
  await beginTenant(first);
  const reclaimed = await claim(first, CLAIM_RECLAIM, 1, 60_000);
  assert.deepEqual(reclaimed, [EXPIRED_EVENT_ID], 'expired claim must become eligible again');

  const published = await first.query(
    `UPDATE outbox.events
        SET published_at = clock_timestamp(), claim_token = NULL, claimed_at = NULL
      WHERE id = $1 AND claim_token = $2 AND published_at IS NULL
      RETURNING id`,
    [EXPIRED_EVENT_ID, CLAIM_RECLAIM],
  );
  assert.equal(published.rowCount, 1, 'active claim must mark the event as published');
  await first.query('COMMIT');

  await beginTenant(second);
  const afterPublish = await claim(second, CLAIM_TWO, 10, 60_000);
  assert.equal(afterPublish.includes(EXPIRED_EVENT_ID), false, 'published event must not be claimed');
  await second.query('ROLLBACK');
}

async function validateAtomicCommitAndRollback() {
  const rollbackEventId = '01990232-0000-7000-8000-000000000301';
  await beginTenant(first);
  await first.query(`INSERT INTO ${PROBE_TABLE} (id, note) VALUES (1, 'rollback')`);
  await first.query(
    `INSERT INTO audit.audit_events (
       tenant_id, category, action, entity_type, entity_id, outcome
     ) VALUES ($1, 'operation', 'outbox.rollback', 'freight', 'rollback', 'SUCCESS')`,
    [TENANT_ID],
  );
  await appendOutbox(first, rollbackEventId, 'freight.updated', { transaction: 'rollback' });
  await first.query('ROLLBACK');

  const rolledBack = await admin.query(
    `SELECT
       (SELECT count(*) FROM ${PROBE_TABLE} WHERE id = 1) AS business_count,
       (SELECT count(*) FROM audit.audit_events WHERE tenant_id = $1 AND action = 'outbox.rollback') AS audit_count,
       (SELECT count(*) FROM outbox.events WHERE tenant_id = $1 AND id = $2) AS outbox_count`,
    [TENANT_ID, rollbackEventId],
  );
  assert.equal(Number(rolledBack.rows[0].business_count), 0);
  assert.equal(Number(rolledBack.rows[0].audit_count), 0);
  assert.equal(Number(rolledBack.rows[0].outbox_count), 0);

  const commitEventId = '01990232-0000-7000-8000-000000000302';
  await beginTenant(first);
  await first.query(`INSERT INTO ${PROBE_TABLE} (id, note) VALUES (2, 'commit')`);
  await first.query(
    `INSERT INTO audit.audit_events (
       tenant_id, category, action, entity_type, entity_id, outcome
     ) VALUES ($1, 'operation', 'outbox.commit', 'freight', 'commit', 'SUCCESS')`,
    [TENANT_ID],
  );
  await appendOutbox(first, commitEventId, 'freight.updated', { transaction: 'commit' });
  await first.query('COMMIT');

  const committed = await admin.query(
    `SELECT
       (SELECT count(*) FROM ${PROBE_TABLE} WHERE id = 2) AS business_count,
       (SELECT count(*) FROM audit.audit_events WHERE tenant_id = $1 AND action = 'outbox.commit') AS audit_count,
       (SELECT count(*) FROM outbox.events WHERE tenant_id = $1 AND id = $2) AS outbox_count`,
    [TENANT_ID, commitEventId],
  );
  assert.equal(Number(committed.rows[0].business_count), 1);
  assert.equal(Number(committed.rows[0].audit_count), 1);
  assert.equal(Number(committed.rows[0].outbox_count), 1);
}

async function validateIdempotentReplayDoesNotDuplicateOutbox() {
  const eventId = '01990232-0000-7000-8000-000000000401';

  await beginTenant(first);
  const acquired = await claimIdempotency(first);
  assert.equal(acquired.rowCount, 1, 'first idempotent execution must acquire the key');
  await appendOutbox(first, eventId, 'freight.contracted', { idempotent: true });
  await first.query(
    `UPDATE idempotency.records
        SET state = 'COMPLETED', response_status = 200,
            response_media_type = 'application/json', response_body = '{"ok":true}'::jsonb,
            response_headers = '{}'::jsonb, completed_at = clock_timestamp()
      WHERE tenant_id = $1 AND operation_key = $2 AND key_hash = $3`,
    [TENANT_ID, IDEMPOTENCY_OPERATION, IDEMPOTENCY_KEY_HASH],
  );
  await first.query('COMMIT');

  await beginTenant(second);
  const replayClaim = await claimIdempotency(second);
  assert.equal(replayClaim.rowCount, 0, 'replay must not reacquire a committed idempotency key');
  if (replayClaim.rowCount === 1) {
    await appendOutbox(second, '01990232-0000-7000-8000-000000000402', 'freight.contracted', { duplicate: true });
  }
  await second.query('COMMIT');

  const count = await admin.query(
    `SELECT count(*) AS event_count
       FROM outbox.events
      WHERE tenant_id = $1 AND event_type = 'freight.contracted'`,
    [TENANT_ID],
  );
  assert.equal(Number(count.rows[0].event_count), 1, 'idempotent replay must not duplicate outbox event');
}

async function beginTenant(client) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('moventra.tenant_id', $1, true)", [TENANT_ID]);
}

async function claim(client, claimToken, limit, claimTtlMs) {
  const result = await client.query(
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
     RETURNING event.id`,
    [claimTtlMs, limit, claimToken],
  );
  return result.rows.map((row) => row.id);
}

async function appendOutbox(client, eventId, eventType, payload) {
  const result = await client.query(
    `INSERT INTO outbox.events (
       id, tenant_id, aggregate_type, event_type, schema_version, payload, metadata
     ) VALUES ($1, $2, 'freight', $3, 1, $4::jsonb, '{"schemaVersion":1}'::jsonb)
     RETURNING id`,
    [eventId, TENANT_ID, eventType, JSON.stringify(payload)],
  );
  assert.equal(result.rowCount, 1);
}

async function claimIdempotency(client) {
  return client.query(
    `INSERT INTO idempotency.records (
       tenant_id, operation_key, key_hash, key_hash_version,
       fingerprint, fingerprint_version, state, expires_at
     ) VALUES ($1, $2, $3, 1, $4, 1, 'PROCESSING', clock_timestamp() + interval '24 hours')
     ON CONFLICT (tenant_id, operation_key, key_hash) DO NOTHING
     RETURNING id`,
    [TENANT_ID, IDEMPOTENCY_OPERATION, IDEMPOTENCY_KEY_HASH, IDEMPOTENCY_FINGERPRINT],
  );
}

async function cleanupFixture() {
  try {
    await admin.query('DELETE FROM outbox.events WHERE tenant_id = $1', [TENANT_ID]);
    await admin.query('DELETE FROM idempotency.records WHERE tenant_id = $1', [TENANT_ID]);
    await admin.query('DELETE FROM audit.audit_events WHERE tenant_id = $1', [TENANT_ID]);
    await admin.query('DELETE FROM organization.tenants WHERE id = $1', [TENANT_ID]);
    await admin.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  } catch (error) {
    process.stderr.write(`Outbox validation cleanup failed: ${error.message}\n`);
  }
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Best-effort cleanup for a validation-only transaction.
  }
}
