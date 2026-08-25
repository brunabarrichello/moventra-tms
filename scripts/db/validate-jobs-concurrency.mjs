import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresJobRepository } from '../../src/infrastructure/jobs/postgres-job-repository.js';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL || undefined });

await client.connect();
await client.query('BEGIN');
try {
  // Keep the migration-owned recurring dispatcher out of this isolated concurrency sample.
  await client.query(
    `UPDATE jobs.system_jobs
        SET status = 'succeeded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE job_type = 'system.outbox_dispatch'`,
  );

  const repository = new PostgresJobRepository({
    query: (text, values) => client.query(text, values),
    scope: 'system',
  });
  for (let index = 0; index < 12; index += 1) {
    await repository.enqueue({
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
  }

  const [a, b] = await Promise.all([
    repository.claimBatch({ limit: 12, leaseMs: 5000, leaseToken: randomUUID() }),
    repository.claimBatch({ limit: 12, leaseMs: 5000, leaseToken: randomUUID() }),
  ]);
  const ids = [...a, ...b].map((job) => job.id);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12, 'concurrent workers must not claim the same job');

  const target = a[0] ?? b[0];
  assert.ok(target);
  assert.equal(await repository.heartbeat({ jobId: target.id, leaseToken: target.leaseToken, leaseMs: 5000 }), true);
  const completed = await repository.completeSuccess({ jobId: target.id, leaseToken: target.leaseToken });
  assert.equal(completed.status, 'succeeded');

  const retryTarget = a[1] ?? b[1];
  assert.ok(retryTarget);
  const retry = await repository.completeFailure({
    jobId: retryTarget.id,
    leaseToken: retryTarget.leaseToken,
    retryable: true,
    errorCode: 'MVT_DEPENDENCY_UNAVAILABLE',
    errorClass: 'retryable',
    delayMs: 1000,
  });
  assert.equal(retry.status, 'retry_scheduled');

  process.stdout.write(JSON.stringify({ status: 'ok', claimed: ids.length, uniqueClaims: new Set(ids).size }) + '\n');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
