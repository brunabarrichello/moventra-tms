import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(root, 'db/migrations/0003_company.sql');
const validationPath = path.join(root, 'db/validation/0003_company_validation.sql');

function executableSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

test('phase 009 migration creates only tenant-scoped Company', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /CREATE\s+TABLE\s+organization\.companies/i);
  assert.match(migration, /^\s*tenant_id\s+UUID\s+NOT\s+NULL/im);
  assert.match(
    migration,
    /FOREIGN\s+KEY\s*\(\s*tenant_id\s*\)\s*REFERENCES\s+organization\.tenants\s*\(\s*id\s*\)/i,
  );

  const forbiddenTables = [
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
      `phase 009 must not create later-phase table ${table}`,
    );
  }

  assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
  assert.doesNotMatch(migration, /^\s*cnpj\s+/im);
});

test('phase 009 migration encodes tenant-aware identity and future composite-FK support', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /id\s+UUID\s+NOT\s+NULL\s+DEFAULT\s+uuidv7\s*\(\s*\)/i);
  assert.match(
    migration,
    /CONSTRAINT\s+uq_companies_tenant_id_id\s+UNIQUE\s*\(\s*tenant_id\s*,\s*id\s*\)/i,
  );
  assert.match(
    migration,
    /CONSTRAINT\s+uq_companies_tenant_id_code\s+UNIQUE\s*\(\s*tenant_id\s*,\s*code\s*\)/i,
  );
  assert.match(
    migration,
    /CREATE\s+INDEX\s+ix_companies_tenant_id_status\s+ON\s+organization\.companies\s*\(\s*tenant_id\s*,\s*status\s*\)/i,
  );
  assert.match(migration, /version\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
});

test('phase 009 lifecycle and jurisdiction-neutral tax identifier contract are encoded', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  for (const status of ['DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED']) {
    assert.ok(migration.includes(`'${status}'`), `missing company lifecycle status ${status}`);
  }

  assert.match(migration, /registration_country\s+CHAR\s*\(\s*2\s*\)\s+NOT\s+NULL/i);
  assert.match(migration, /primary_tax_identifier_type\s+TEXT/i);
  assert.match(migration, /primary_tax_identifier\s+TEXT/i);
  assert.match(migration, /ck_companies_tax_identifier_pair/i);
  assert.match(migration, /uq_companies_tenant_tax_identifier/i);
});

test('phase 009 validation checks physical tenant-aware company contract and migration history', async () => {
  const validation = await readFile(validationPath, 'utf8');

  assert.match(validation, /to_regclass\('organization\.companies'\)/);
  assert.match(validation, /organization\.companies\.tenant_id must be UUID NOT NULL/);
  assert.match(validation, /company tenant foreign key is missing or invalid/);
  assert.match(validation, /uq_companies_tenant_id_id/);
  assert.match(validation, /uq_companies_tenant_id_code/);
  assert.match(validation, /version\s*=\s*3/);
  assert.match(validation, /name\s*=\s*'0003_company\.sql'/);
});
