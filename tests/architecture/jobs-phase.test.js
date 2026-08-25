import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 025 materializes durable provider-neutral Jobs without administrative DLQ', () => {
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
    'docs/implementation/025-jobs.md',
  ]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }
  assert.equal(existsSync(new URL('../../src/modules/dlq/', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../db/migrations/0017_dlq.sql', import.meta.url)), false);

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
