import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('Job replay accepts only DLQ identity/version and never operator payload or routing data', async () => {
  const source = await read('src/modules/dlq/job-reprocessor.js');

  assert.match(source, /async reprocess\(\{ id, expectedVersion, claimToken/);
  assert.doesNotMatch(source, /async reprocess\(\{[^}]*payload/);
  assert.doesNotMatch(source, /async reprocess\(\{[^}]*jobType/);
  assert.doesNotMatch(source, /async reprocess\(\{[^}]*scheduleKey/);
  assert.doesNotMatch(source, /async reprocess\(\{[^}]*tenantId/);
});

test('Job replay validates registered handler contract but never executes the handler inline', async () => {
  const source = await read('src/modules/dlq/job-reprocessor.js');

  assert.match(source, /this\.registry\.resolve\(source\)/);
  assert.match(source, /rescheduleFromTerminal/);
  assert.doesNotMatch(source, /await\s+this\.registry\.resolve\(source\)\s*\(/);
  assert.doesNotMatch(source, /handler\s*\(/);
});

test('repository rebuilds replay exclusively from authoritative terminal Job rows', async () => {
  const repository = await read('src/infrastructure/jobs/postgres-job-reprocess-repository.js');

  assert.match(repository, /FROM jobs\.jobs AS source/);
  assert.match(repository, /FROM jobs\.system_jobs AS source/);
  assert.match(repository, /source\.status = 'failed_terminal'/);
  assert.match(repository, /source\.payload/);
  assert.match(repository, /source\.metadata/);
  assert.match(repository, /reprocessed_from_job_id/);
  assert.match(repository, /reprocessed_from_dlq_entry_id/);
  assert.match(repository, /ON CONFLICT DO NOTHING/);
  assert.match(repository, /WHERE reprocessed_from_dlq_entry_id = \$1/);
});

test('database lineage blocks cross-tenant references and duplicate logical replay', async () => {
  const migration = await read('db/migrations/0020_dlq_job_reprocessing_lineage.sql');

  assert.match(migration, /FOREIGN KEY \(tenant_id, reprocessed_from_job_id\)/);
  assert.match(migration, /REFERENCES jobs\.jobs\(tenant_id, id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, reprocessed_from_dlq_entry_id\)/);
  assert.match(migration, /REFERENCES dlq\.entries\(tenant_id, id\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_jobs_reprocessed_from_dlq/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_system_jobs_reprocessed_from_dlq/);
});

test('system replay lineage remains physically separate from tenant tables', async () => {
  const migration = await read('db/migrations/0020_dlq_job_reprocessing_lineage.sql');
  const repository = await read('src/infrastructure/jobs/postgres-job-reprocess-repository.js');

  assert.match(migration, /REFERENCES dlq\.system_entries\(id\)/);
  assert.match(repository, /system: 'jobs\.system_jobs'/);
  assert.doesNotMatch(migration, /tenant_id\s+UUID\s+NULL/);
});
