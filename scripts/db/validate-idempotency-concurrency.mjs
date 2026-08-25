import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const TENANT_ID = '01990222-0000-7000-8000-000000000001';
const KEY_HASH = 'a'.repeat(64);
const ROLLBACK_KEY_HASH = 'c'.repeat(64);
const FINGERPRINT = 'b'.repeat(64);
const OPERATION_KEY = 'validation.concurrent.idempotency';
const PROBE_TABLE = 'public.moventra_idempotency_concurrency_probe';

const admin = new Client();
const first = new Client();
const second = new Client();

await Promise.all([admin.connect(), first.connect(), second.connect()]);

try {
  await prepareFixture();
  await validateCommittedWinner();
  await validateRolledBackClaimCanBeRetried();
  process.stdout.write('Idempotency PostgreSQL concurrency contract passed.\n');
} finally {
  await Promise.allSettled([
    rollbackQuietly(first),
    rollbackQuietly(second),
  ]);
  await cleanupFixture();
  await Promise.allSettled([admin.end(), first.end(), second.end()]);
}

async function prepareFixture() {
  await admin.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  await admin.query(
    `DELETE FROM idempotency.records
      WHERE tenant_id = $1`,
    [TENANT_ID],
  );
  await admin.query(
    `DELETE FROM organization.tenants
      WHERE id = $1`,
    [TENANT_ID],
  );
  await admin.query(
    `INSERT INTO organization.tenants (
       id, code, display_name, status, default_timezone, default_currency
     ) VALUES ($1, 'idempotency-concurrency-ci', 'Idempotency Concurrency CI', 'ACTIVE', 'UTC', 'USD')`,
    [TENANT_ID],
  );
  await admin.query(
    `CREATE TABLE ${PROBE_TABLE} (
       id INTEGER PRIMARY KEY,
       executions INTEGER NOT NULL DEFAULT 0
     )`,
  );
  await admin.query(`INSERT INTO ${PROBE_TABLE} (id, executions) VALUES (1, 0)`);
}

async function validateCommittedWinner() {
  await beginTenant(first);
  const firstClaim = await claim(first, KEY_HASH);
  assert.equal(firstClaim.rowCount, 1, 'first concurrent request must acquire the key');

  const secondPromise = runConcurrentRequest({ keyHash: KEY_HASH, expectedReplay: true });
  await delay(100);

  await first.query(`UPDATE ${PROBE_TABLE} SET executions = executions + 1 WHERE id = 1`);
  await complete(first, KEY_HASH, { committed: true });
  await first.query('COMMIT');

  const secondResult = await secondPromise;
  assert.equal(secondResult, 'replayed');

  const probe = await admin.query(`SELECT executions FROM ${PROBE_TABLE} WHERE id = 1`);
  assert.equal(Number(probe.rows[0].executions), 1, 'concurrent duplicate must not duplicate effect');
}

async function validateRolledBackClaimCanBeRetried() {
  await beginTenant(first);
  const firstClaim = await claim(first, ROLLBACK_KEY_HASH);
  assert.equal(firstClaim.rowCount, 1, 'rollback scenario first request must acquire key');

  const secondPromise = runConcurrentRequest({
    keyHash: ROLLBACK_KEY_HASH,
    expectedReplay: false,
  });
  await delay(100);

  await first.query('ROLLBACK');
  const secondResult = await secondPromise;
  assert.equal(secondResult, 'executed');

  const probe = await admin.query(`SELECT executions FROM ${PROBE_TABLE} WHERE id = 1`);
  assert.equal(
    Number(probe.rows[0].executions),
    2,
    'rolled-back claim must allow exactly one subsequent committed effect',
  );
}

async function runConcurrentRequest({ keyHash, expectedReplay }) {
  await beginTenant(second);
  try {
    const claimed = await claim(second, keyHash);
    if (claimed.rowCount === 1) {
      assert.equal(expectedReplay, false, 'duplicate unexpectedly acquired committed key');
      await second.query(`UPDATE ${PROBE_TABLE} SET executions = executions + 1 WHERE id = 1`);
      await complete(second, keyHash, { retriedAfterRollback: true });
      await second.query('COMMIT');
      return 'executed';
    }

    assert.equal(expectedReplay, true, 'retry after rollback should acquire the key');
    const stored = await second.query(
      `SELECT fingerprint, fingerprint_version, state, response_status, response_body
         FROM idempotency.records
        WHERE tenant_id = $1 AND operation_key = $2 AND key_hash = $3`,
      [TENANT_ID, OPERATION_KEY, keyHash],
    );
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0].fingerprint.trim(), FINGERPRINT);
    assert.equal(Number(stored.rows[0].fingerprint_version), 1);
    assert.equal(stored.rows[0].state, 'COMPLETED');
    assert.equal(Number(stored.rows[0].response_status), 200);
    await second.query('COMMIT');
    return 'replayed';
  } catch (error) {
    await rollbackQuietly(second);
    throw error;
  }
}

async function beginTenant(client) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('moventra.tenant_id', $1, true)", [TENANT_ID]);
}

async function claim(client, keyHash) {
  return client.query(
    `INSERT INTO idempotency.records (
       tenant_id, operation_key, key_hash, key_hash_version,
       fingerprint, fingerprint_version, state, expires_at
     ) VALUES ($1, $2, $3, 1, $4, 1, 'PROCESSING', clock_timestamp() + interval '24 hours')
     ON CONFLICT (tenant_id, operation_key, key_hash) DO NOTHING
     RETURNING id`,
    [TENANT_ID, OPERATION_KEY, keyHash, FINGERPRINT],
  );
}

async function complete(client, keyHash, body) {
  const result = await client.query(
    `UPDATE idempotency.records
        SET state = 'COMPLETED',
            response_status = 200,
            response_media_type = 'application/json',
            response_body = $4::jsonb,
            response_headers = '{}'::jsonb,
            completed_at = clock_timestamp()
      WHERE tenant_id = $1
        AND operation_key = $2
        AND key_hash = $3
        AND state = 'PROCESSING'`,
    [TENANT_ID, OPERATION_KEY, keyHash, JSON.stringify(body)],
  );
  assert.equal(result.rowCount, 1, 'acquired idempotency record must complete exactly once');
}

async function cleanupFixture() {
  try {
    await admin.query(`DELETE FROM idempotency.records WHERE tenant_id = $1`, [TENANT_ID]);
    await admin.query(`DELETE FROM organization.tenants WHERE id = $1`, [TENANT_ID]);
    await admin.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  } catch (error) {
    process.stderr.write(`Idempotency concurrency cleanup failed: ${error.message}\n`);
  }
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Best-effort cleanup after a validation-only transaction.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
