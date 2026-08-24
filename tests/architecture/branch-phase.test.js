import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(root, 'db/migrations/0004_branch.sql');
const validationPath = path.join(root, 'db/validation/0004_branch_validation.sql');
const repositoryPath = path.join(
  root,
  'src/modules/organization/branch/branch-repository.js',
);

function executableSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

test('phase 010 migration creates only the branch organizational unit', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /CREATE\s+TABLE\s+organization\.branches/i);

  const forbiddenTables = [
    'users',
    'memberships',
    'roles',
    'permissions',
    'sessions',
    'audit_logs',
    'warehouses',
    'customers',
  ];

  for (const table of forbiddenTables) {
    assert.doesNotMatch(
      migration,
      new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+[a-z0-9_.]*${table}\\b`, 'i'),
      `phase 010 must not create later-phase/domain table ${table}`,
    );
  }

  assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
});

test('phase 010 database contract preserves tenant/company scope in keys', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /tenant_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(migration, /company_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(
    migration,
    /FOREIGN\s+KEY\s*\(\s*tenant_id\s*,\s*company_id\s*\)\s*REFERENCES\s+organization\.companies\s*\(\s*tenant_id\s*,\s*id\s*\)/i,
  );
  assert.match(
    migration,
    /CONSTRAINT\s+uq_branches_tenant_company_id\s+UNIQUE\s*\(\s*tenant_id\s*,\s*company_id\s*,\s*id\s*\)/i,
  );
  assert.match(
    migration,
    /CONSTRAINT\s+uq_branches_tenant_company_code\s+UNIQUE\s*\(\s*tenant_id\s*,\s*company_id\s*,\s*code\s*\)/i,
  );
  assert.match(
    migration,
    /CREATE\s+UNIQUE\s+INDEX\s+uq_branches_tenant_company_headquarters[\s\S]*WHERE\s+is_headquarters/i,
  );
});

test('phase 010 lifecycle and optimistic-lock contracts are encoded in the migration', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  for (const status of ['DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED']) {
    assert.ok(migration.includes(`'${status}'`), `missing branch lifecycle status ${status}`);
  }

  assert.match(migration, /id\s+UUID\s+NOT\s+NULL\s+DEFAULT\s+uuidv7\s*\(\s*\)/i);
  assert.match(migration, /version\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
  assert.match(migration, /is_headquarters\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);
});

test('phase 010 repository requires tenant and company scope for reads and mutations', async () => {
  const repository = await readFile(repositoryPath, 'utf8');

  assert.match(repository, /async findById\(tenantId, companyId, id\)/);
  assert.match(repository, /async findByCode\(tenantId, companyId, code\)/);
  assert.match(repository, /async updateProfile\(tenantId, companyId, id, input, expectedVersion\)/);
  assert.match(repository, /async transitionStatus\(tenantId, companyId, id, toStatus, expectedVersion\)/);
  assert.match(repository, /WHERE tenant_id = \$1[\s\S]*AND company_id = \$2[\s\S]*AND id = \$3/);
});

test('phase 010 validation checks physical branch contract and migration history', async () => {
  const validation = await readFile(validationPath, 'utf8');

  assert.match(validation, /to_regclass\('organization\.branches'\)/);
  assert.match(validation, /fk_branches_company_scope/);
  assert.match(validation, /uq_branches_tenant_company_id/);
  assert.match(validation, /uq_branches_tenant_company_headquarters/);
  assert.match(validation, /version\s*=\s*4/);
  assert.match(validation, /name\s*=\s*'0004_branch\.sql'/);
});
