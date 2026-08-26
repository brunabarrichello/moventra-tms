import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresJobRepository } from '../../src/infrastructure/jobs/postgres-job-repository.js';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL || undefined;
const admin = new Client({ connectionString });
const workerA = new Client({ connectionString });
const workerB = new Client({ connectionString });
const seededIds = [];

await admin.connect();
try {
  // Keep the migration-owned recurring dispatcher out of this isolated concurrency sample.
  await admin.query(
    `UPDATE jobs.system_jobs
        SET status = 'succeeded',
            completed_at = clock_timestamp(),
            lease_token = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            last_heartbeat_at = NULL,
            updated_at = clock_timestamp()
      WHERE job_type = 'system.outbox_dispatch'`,
  );

  const seedRepository = new PostgresJobRepository({
    query: (text, values) => admin.query(text, values),
    scope: 'system',
  });
  for (let index = 0; index < 12; index += 1) {
    const job = await seedRepository.enqueue({
      tenantId: null,
      scope: 'system',
      jobType: 'system.release_smoke',
      schemaVersion: 1,
      payload: {},
      metadata: {},
      priority: index % 3,
      availableAt: new Date().toISOString(),
      maxAttempts: 3,
      scheduleKey: null,
      recurrenceIntervalMs: null,
    });
    seededIds.push(job.id);
  }

  await Promise.all([workerA.connect(), workerB.connect()]);
  const repositoryA = new PostgresJobRepository({
    query: (text, values) => workerA.query(text, values),
    scope: 'system',
  });
  const repositoryB = new PostgresJobRepository({
    query: (text, values) => workerB.query(text, values),
    scope: 'system',
  });

  await Promise.all([workerA.query('BEGIN'), workerB.query('BEGIN')]);
  let a;
  let b;
  try {
    // Each transaction holds its UPDATE row locks until both claims have completed. The
    // second session must therefore skip the first session's six locked rows rather than
    // waiting for or double-claiming them.
    [a, b] = await Promise.all([
      repositoryA.claimBatch({ limit: 6, leaseMs: 5000, leaseToken: randomUUID() }),
      repositoryB.claimBatch({ limit: 6, leaseMs: 5000, leaseToken: randomUUID() }),
    ]);
    await Promise.all([workerA.query('COMMIT'), workerB.query('COMMIT')]);
  } catch (error) {
    await Promise.all([
      workerA.query('ROLLBACK').catch(() => {}),
      workerB.query('ROLLBACK').catch(() => {}),
    ]);
    throw error;
  }

  assert.equal(a.length, 6, 'worker A must claim exactly its bounded share');
  assert.equal(b.length, 6, 'worker B must claim exactly its bounded share');
  const ids = [...a, ...b].map((job) => job.id);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12, 'concurrent workers must not claim the same job');

  const target = a[0];
  assert.ok(target);
  assert.equal(await repositoryA.heartbeat({ jobId: target.id, leaseToken: target.leaseToken, leaseMs: 5000 }), true);
  const completed = await repositoryA.completeSuccess({ jobId: target.id, leaseToken: target.leaseToken });
  assert.equal(completed.status, 'succeeded');

  const retryTarget = b[0];
  assert.ok(retryTarget);
  const retry = await repositoryB.completeFailure({
    jobId: retryTarget.id,
    leaseToken: retryTarget.leaseToken,
    retryable: true,
    errorCode: 'MVT_DEPENDENCY_UNAVAILABLE',
    errorClass: 'retryable',
    delayMs: 1000,
  });
  assert.equal(retry.status, 'retry_scheduled');

  process.stdout.write(JSON.stringify({
    status: 'ok',
    concurrentSessions: 2,
    claimed: ids.length,
    uniqueClaims: new Set(ids).size,
  }) + '\n');
} finally {
  await workerA.end().catch(() => {});
  await workerB.end().catch(() => {});
  if (seededIds.length > 0) {
    await admin.query('DELETE FROM jobs.system_jobs WHERE id = ANY($1::uuid[])', [seededIds]).catch(() => {});
  }
  await admin.query(
    `UPDATE jobs.system_jobs
        SET status = 'scheduled',
            available_at = clock_timestamp(),
            attempt_count = 0,
            lease_token = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            last_heartbeat_at = NULL,
            last_error_code = NULL,
            last_error_class = NULL,
            completed_at = NULL,
            updated_at = clock_timestamp()
      WHERE job_type = 'system.outbox_dispatch'`,
  ).catch(() => {});
  await admin.end();
}
