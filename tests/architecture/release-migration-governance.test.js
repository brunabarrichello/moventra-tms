import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('manual CI dispatch intent is preserved into the staging release gate', async () => {
  const workflow = await read('.github/workflows/release-gate.yml');

  assert.match(workflow, /UPSTREAM_EVENT:/);
  assert.match(workflow, /\$UPSTREAM_EVENT" == workflow_dispatch/);
  assert.match(workflow, /source_event/);
  assert.match(workflow, /push\|workflow_dispatch/);
});

test('downstream release workflows derive execution from upstream evidence instead of reclassifying the diff', async () => {
  for (const relativePath of [
    '.github/workflows/rollback-drill.yml',
    '.github/workflows/production-promotion.yml',
  ]) {
    const workflow = await read(relativePath);
    assert.match(workflow, /classify-upstream-release-evidence\.sh/);
    assert.doesNotMatch(workflow, /classify-release-impact\.sh/);
    assert.match(workflow, /upstream-release-evidence/);
  }
});

test('staging and production promote database migrations with a dedicated protected credential', async () => {
  for (const relativePath of [
    '.github/workflows/release-gate.yml',
    '.github/workflows/production-promotion.yml',
  ]) {
    const workflow = await read(relativePath);
    assert.match(workflow, /apply-database-migrations\.sh/);
    assert.match(workflow, /MIGRATIONS_DATABASE_URL/);
    assert.match(workflow, /database_migration_checksum/);
  }

  const migrationScript = await read('scripts/release/apply-database-migrations.sh');
  assert.match(migrationScript, /MIGRATIONS_DATABASE_URL is required/);
  assert.match(migrationScript, /export DATABASE_URL="\$MIGRATIONS_DATABASE_URL"/);
  assert.match(migrationScript, /Database still has pending migrations/);
  assert.match(migrationScript, /database_migration_checksum/);
});

test('rollback drill proves previous application revision against the already promoted forward schema', async () => {
  const rollback = await read('.github/workflows/rollback-drill.yml');
  const production = await read('.github/workflows/production-promotion.yml');

  assert.match(rollback, /Smoke rolled-back revision against forward schema/);
  assert.match(rollback, /smoke-database-health\.sh/);
  assert.match(rollback, /forward_schema_rollback_compatibility/);
  assert.match(production, /forward_schema_compatibility/);
  assert.match(production, /staging_forward_schema_rollback_compatibility=success/);
});
