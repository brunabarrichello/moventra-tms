import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('db/migrations/0017_dlq.sql', 'utf8');
const runtimeAccess = fs.readFileSync('db/runtime/runtime-access.sql', 'utf8');
const workerAccess = fs.readFileSync('db/runtime/worker-access.sql', 'utf8');
const domain = fs.readFileSync('src/modules/dlq/dlq-contract.js', 'utf8');
const repository = fs.readFileSync('src/infrastructure/dlq/postgres-dlq-repository.js', 'utf8');
const documentation = fs.readFileSync('docs/implementation/026-dlq.md', 'utf8');

test('026 mantém tenant e system DLQ fisicamente separados', () => {
  assert.match(migration, /CREATE TABLE dlq\.entries \(/);
  assert.match(migration, /tenant_id UUID NOT NULL/);
  assert.match(migration, /ALTER TABLE dlq\.entries ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = security\.current_tenant_id\(\)/);
  assert.match(migration, /CREATE TABLE dlq\.system_entries \(/);

  const systemTable = migration
    .split('CREATE TABLE dlq.system_entries (')[1]
    .split('CREATE UNIQUE INDEX ux_dlq_system_entries_source')[0];
  assert.doesNotMatch(systemTable, /tenant_id\s+UUID/);
});

test('026 possui dedupe, bounded retry e catálogo RBAC estável', () => {
  assert.match(migration, /ux_dlq_entries_source/);
  assert.match(migration, /ux_dlq_system_entries_source/);
  assert.match(migration, /max_reprocess_attempts BETWEEN 1 AND 25/);
  assert.match(migration, /reprocess_count <= max_reprocess_attempts/);
  assert.match(migration, /'dlq\.read'/);
  assert.match(migration, /'dlq\.reprocess'/);
  assert.match(migration, /'dlq\.resolve'/);
  assert.match(migration, /'dlq\.discard'/);
});

test('normal application runtime não pode inserir DLQ nem acessar system_entries', () => {
  assert.match(runtimeAccess, /GRANT SELECT ON dlq\.entries/);
  assert.match(runtimeAccess, /REVOKE INSERT, DELETE ON dlq\.entries/);
  assert.match(runtimeAccess, /REVOKE ALL PRIVILEGES ON dlq\.system_entries/);
  assert.match(runtimeAccess, /REVOKE UPDATE \([\s\S]*snapshot,[\s\S]*metadata,[\s\S]*\) ON dlq\.entries/);
});

test('worker permanece fail-closed para DLQ antes da capability estreita', () => {
  assert.match(workerAccess, /REVOKE ALL PRIVILEGES ON SCHEMA dlq/);
  assert.match(workerAccess, /REVOKE ALL PRIVILEGES ON dlq\.entries/);
  assert.match(workerAccess, /REVOKE ALL PRIVILEGES ON dlq\.system_entries/);
});

test('domínio DLQ é provider-neutral e não depende de pg/amqplib', () => {
  assert.doesNotMatch(domain, /from ['"]pg['"]/);
  assert.doesNotMatch(domain, /from ['"]amqplib['"]/);
  assert.doesNotMatch(repository, /from ['"]amqplib['"]/);
  assert.match(documentation, /provider-neutral/i);
  assert.match(documentation, /Production somente após gate humano explícito/i);
});
