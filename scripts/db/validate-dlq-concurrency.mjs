import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresDlqRepository } from '../../src/infrastructure/dlq/postgres-dlq-repository.js';
import { PostgresJobReprocessRepository } from '../../src/infrastructure/jobs/postgres-job-reprocess-repository.js';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL || undefined;
const runtimeRole = process.env.MOVENTRA_CONCURRENCY_ROLE || 'moventra_app_ci';
const TENANT_ID = '01990226-0000-7000-8000-000000000026';
const TENANT_CODE = 'dlq-concurrency-ci';

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error('MOVENTRA_CONCURRENCY_ROLE must be a safe PostgreSQL role identifier');
}

const admin = new Client({ connectionString });
const operatorA = new Client({ connectionString });
const operatorB = new Client({ connectionString });

await Promise.all([admin.connect(), operatorA.connect(), operatorB.connect()]);

try {
  await cleanupFixture();
  await prepareTenant();
  const decisionEvidence = await validateTerminalDecisionConcurrency();
  const replayEvidence = await validateJobReplayConcurrency();

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    concurrentSessions: 2,
    terminalDecisionWinners: decisionEvidence.winners,
    logicalReplayChildren: replayEvidence.children,
    replayChildIdStableAcrossRacers: replayEvidence.sameChild,
    runtimeRole,
  })}\n`);
} finally {
  await Promise.allSettled([
    rollbackQuietly(operatorA),
    rollbackQuietly(operatorB),
  ]);
  await cleanupFixture();
  await Promise.allSettled([admin.end(), operatorA.end(), operatorB.end()]);
}

async function prepareTenant() {
  await admin.query(
    `INSERT INTO organization.tenants (
       id, code, display_name, status, default_timezone, default_currency
     ) VALUES ($1, $2, 'DLQ Concurrency CI', 'ACTIVE', 'UTC', 'USD')`,
    [TENANT_ID, TENANT_CODE],
  );
}

async function validateTerminalDecisionConcurrency() {
  const seeded = await admin.query(
    `INSERT INTO dlq.entries (
       tenant_id, source_kind, source_id, source_type, source_schema_version,
       failure_code, failure_class, snapshot, metadata, max_reprocess_attempts
     ) VALUES (
       $1, 'message', uuidv7(), 'validation.concurrent_message', 1,
       'MVT_VALIDATION_FAILED', 'terminal', '{}'::jsonb, '{}'::jsonb, 5
     )
     RETURNING id, version`,
    [TENANT_ID],
  );
  assert.equal(seeded.rowCount, 1);
  const entryId = seeded.rows[0].id;
  assert.equal(Number(seeded.rows[0].version), 1);

  await beginTenant(operatorA);
  const repositoryA = tenantDlqRepository(operatorA);
  const winner = await repositoryA.resolve({
    id: entryId,
    expectedVersion: 1,
    actorId: null,
    resolutionCode: 'resolved_by_operator',
  });
  assert.equal(winner?.status, 'resolved');

  const loserPromise = (async () => {
    await beginTenant(operatorB);
    try {
      const repositoryB = tenantDlqRepository(operatorB);
      const result = await repositoryB.discard({
        id: entryId,
        expectedVersion: 1,
        actorId: null,
        resolutionCode: 'discarded_by_operator',
      });
      await operatorB.query('COMMIT');
      return result;
    } catch (error) {
      await rollbackQuietly(operatorB);
      throw error;
    }
  })();

  // The second session must be blocked on the row held by A until the first decision commits.
  await delay(100);
  await operatorA.query('COMMIT');
  const loser = await loserPromise;
  assert.equal(loser, null, 'stale concurrent terminal decision must not mutate the entry');

  const persisted = await admin.query(
    `SELECT status, resolution_code, version
       FROM dlq.entries
      WHERE tenant_id = $1 AND id = $2`,
    [TENANT_ID, entryId],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].status, 'resolved');
  assert.equal(persisted.rows[0].resolution_code, 'resolved_by_operator');
  assert.equal(Number(persisted.rows[0].version), 2);

  return { winners: 1 };
}

async function validateJobReplayConcurrency() {
  const source = await admin.query(
    `INSERT INTO jobs.jobs (
       tenant_id, job_type, schema_version, payload, metadata,
       status, priority, available_at, attempt_count, max_attempts
     ) VALUES (
       $1, 'validation.concurrent_job', 1,
       '{"probe":"authoritative"}'::jsonb, '{"source":"dlq-concurrency-ci"}'::jsonb,
       'scheduled', 0, clock_timestamp(), 0, 3
     )
     RETURNING id`,
    [TENANT_ID],
  );
  assert.equal(source.rowCount, 1);
  const sourceJobId = source.rows[0].id;

  const terminal = await admin.query(
    `UPDATE jobs.jobs
        SET status = 'failed_terminal',
            attempt_count = max_attempts,
            last_error_code = 'MVT_VALIDATION_FAILED',
            last_error_class = 'terminal',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE tenant_id = $1 AND id = $2 AND status = 'scheduled'
      RETURNING id`,
    [TENANT_ID, sourceJobId],
  );
  assert.equal(terminal.rowCount, 1);

  const dlq = await admin.query(
    `SELECT id
       FROM dlq.entries
      WHERE tenant_id = $1
        AND source_kind = 'job'
        AND source_id = $2`,
    [TENANT_ID, sourceJobId],
  );
  assert.equal(dlq.rowCount, 1, 'terminal Job trigger must create exactly one DLQ decision');
  const dlqEntryId = dlq.rows[0].id;

  await beginTenant(operatorA);
  const repositoryA = tenantJobReplayRepository(operatorA);
  const firstChild = await repositoryA.rescheduleFromTerminal({ sourceJobId, dlqEntryId });
  assert.ok(firstChild, 'first racer must materialize the durable child Job');
  assert.equal(firstChild.reprocessedFromJobId, sourceJobId);
  assert.equal(firstChild.reprocessedFromDlqEntryId, dlqEntryId);

  const secondPromise = (async () => {
    await beginTenant(operatorB);
    try {
      const repositoryB = tenantJobReplayRepository(operatorB);
      const result = await repositoryB.rescheduleFromTerminal({ sourceJobId, dlqEntryId });
      await operatorB.query('COMMIT');
      return result;
    } catch (error) {
      await rollbackQuietly(operatorB);
      throw error;
    }
  })();

  // The unique lineage index must serialize the competing INSERT until A commits.
  await delay(100);
  await operatorA.query('COMMIT');
  const secondChild = await secondPromise;
  assert.ok(secondChild, 'ambiguous concurrent retry must recover the committed logical child');
  assert.equal(secondChild.id, firstChild.id, 'both racers must converge to the same Job child');

  const persisted = await admin.query(
    `SELECT id, reprocessed_from_job_id, reprocessed_from_dlq_entry_id
       FROM jobs.jobs
      WHERE tenant_id = $1
        AND reprocessed_from_dlq_entry_id = $2`,
    [TENANT_ID, dlqEntryId],
  );
  assert.equal(persisted.rowCount, 1, 'database must persist one logical child per DLQ decision');
  assert.equal(persisted.rows[0].id, firstChild.id);
  assert.equal(persisted.rows[0].reprocessed_from_job_id, sourceJobId);

  return { children: 1, sameChild: true };
}

function tenantDlqRepository(client) {
  return new PostgresDlqRepository({
    query: (text, values) => client.query(text, values),
    scope: 'tenant',
  });
}

function tenantJobReplayRepository(client) {
  return new PostgresJobReprocessRepository({
    query: (text, values) => client.query(text, values),
    scope: 'tenant',
  });
}

async function beginTenant(client) {
  await client.query('BEGIN');
  await client.query(`SET LOCAL ROLE ${runtimeRole}`);
  await client.query("SELECT set_config('moventra.tenant_id', $1, true)", [TENANT_ID]);
}

async function cleanupFixture() {
  try {
    await admin.query(
      `DELETE FROM jobs.jobs
        WHERE tenant_id = $1
          AND reprocessed_from_job_id IS NOT NULL`,
      [TENANT_ID],
    );
    await admin.query('DELETE FROM dlq.entries WHERE tenant_id = $1', [TENANT_ID]);
    await admin.query('DELETE FROM jobs.jobs WHERE tenant_id = $1', [TENANT_ID]);
    await admin.query('DELETE FROM organization.tenants WHERE id = $1', [TENANT_ID]);
  } catch (error) {
    process.stderr.write(`DLQ concurrency cleanup failed: ${error.message}\n`);
  }
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Best-effort validation cleanup.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
