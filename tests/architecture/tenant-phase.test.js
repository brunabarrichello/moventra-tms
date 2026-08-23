import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(root, 'db/migrations/0002_tenant.sql');
const validationPath = path.join(root, 'db/validation/0002_tenant_validation.sql');

function executableSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

test('phase 008 migration creates only the tenant aggregate root', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+organization/i);
  assert.match(migration, /CREATE\s+TABLE\s+organization\.tenants/i);
  assert.doesNotMatch(migration, /^\s*tenant_id\s+/im);

  const forbiddenTables = [
    'companies',
    'branches',
    'users',
    'memberships',
    'roles',
    'permissions',
    'sessions',
    'audit_logs',
  ];

  for (const table of forbiddenTables) {
    assert.doesNotMatch(
      migration,
      new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+[a-z0-9_.]*${table}\\b`, 'i'),
      `phase 008 must not create later-phase table ${table}`,
    );
  }

  assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
});

test('phase 008 lifecycle and optimistic-lock contracts are encoded in the migration', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  for (const status of ['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']) {
    assert.ok(migration.includes(`'${status}'`), `missing tenant lifecycle status ${status}`);
  }

  assert.match(migration, /id\s+UUID\s+NOT\s+NULL\s+DEFAULT\s+uuidv7\s*\(\s*\)/i);
  assert.match(migration, /version\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
  assert.match(migration, /CONSTRAINT\s+uq_tenants_code\s+UNIQUE\s*\(\s*code\s*\)/i);
});

test('phase 008 validation checks the physical tenant contract and migration history', async () => {
  const validation = await readFile(validationPath, 'utf8');

  assert.match(validation, /to_regclass\('organization\.tenants'\)/);
  assert.match(validation, /tenant aggregate root must not contain a tenant_id self-reference/);
  assert.match(validation, /version\s*=\s*2/);
  assert.match(validation, /name\s*=\s*'0002_tenant\.sql'/);
});
