import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 025 remains durable/provider-neutral while active DLQ 026 extends terminal-failure governance', () => {
  for (const path of [
    'db/migrations/0016_jobs.sql',
    'db/validation/0016_jobs_validation.sql',
    'src/modules/jobs/job-contract.js',
    'src/modules/jobs/job-backoff.js',
    'src/modules/jobs/job-handler-registry.js',
    'src/modules/jobs/job-scheduler.js',
    'src/modules/jobs/job-worker.js',
    'src/modules/jobs/outbox-dispatcher-job.js',
    'src/infrastructure/jobs/postgres-job-repository.js',
    'src/infrastructure/outbox/system-outbox-repository.js',
    'src/worker.js',
    'docs/implementation/025-jobs.md',
    'docs/implementation/025-post-audit-reconciliation.md',
    'docs/implementation/026-dlq.md',
    'db/migrations/0017_dlq.sql',
    'src/modules/dlq/dlq-contract.js',
  ]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }

  const migration = read('db/migrations/0016_jobs.sql');
  assert.match(migration, /CREATE TABLE jobs\.jobs[\s\S]*tenant_id UUID NOT NULL/);
  assert.match(migration, /CREATE TABLE jobs\.system_jobs/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf('CREATE TABLE jobs.system_jobs'), migration.indexOf('-- The first system job')),
    /tenant_id/i,
  );
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /REVOKE ALL ON FUNCTION outbox\.claim_system_batch/);
  assert.match(migration, /ALTER TABLE jobs\.jobs ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /system\.outbox_dispatch/);

  const worker = read('src/modules/jobs/job-worker.js');
  assert.match(worker, /heartbeat/);
  assert.match(worker, /runForever/);
  assert.match(worker, /AbortController/);
  assert.doesNotMatch(worker, /eval\(|new Function\(/);

  const reconciliation = read('docs/implementation/025-post-audit-reconciliation.md');
  const dlqDoc = read('docs/implementation/026-dlq.md');
  assert.match(reconciliation, /025 — Jobs = EVIDENCED \/ CONCLUDED/i);
  assert.match(reconciliation, /026 — DLQ = ACTIVE \/ DEFINED/i);
  assert.match(dlqDoc, /failed_terminal/i);
});

test('phase 025 provides a dedicated non-HTTP worker composition root', () => {
  const runtime = read('src/worker.js');
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.scripts['start:worker'], 'node src/worker.js');
  assert.match(runtime, /new PostgresJobRepository\([\s\S]*scope: 'system'/);
  assert.match(runtime, /OUTBOX_DISPATCH_JOB_TYPE/);
  assert.match(runtime, /worker\.runForever\(\{ signal: shutdownController\.signal \}\)/);
  assert.match(runtime, /verifyWorkerDatabasePrincipal/);
  assert.match(runtime, /rolbypassrls/);
  assert.match(runtime, /has_function_privilege/);
  assert.match(runtime, /closeDatabasePool/);
  assert.match(runtime, /shutdownObservability/);
  assert.doesNotMatch(runtime, /createServer|requestHandler|server\.listen/);
});

test('Outbox Dispatcher preserves confirm-before-markPublished invariant', () => {
  const dispatcher = read('src/modules/jobs/outbox-dispatcher-job.js');
  const publishIndex = dispatcher.indexOf('await messagingPublisher.publish');
  const markIndex = dispatcher.indexOf('await outboxService.markPublished');
  assert.ok(publishIndex >= 0 && markIndex > publishIndex);
  assert.match(dispatcher, /confirmed !== true/);
  assert.match(dispatcher, /mapOutboxEventToMessage/);
});

test('Jobs observability keeps identifiers out of metric dimensions', () => {
  const source = read('src/modules/jobs/job-observability.js');
  assert.match(source, /jobs_operations_total/);
  assert.match(source, /jobs_operation_duration_ms/);
  assert.doesNotMatch(source, /tenantId|jobId|leaseToken|correlationId|payload/);
});
