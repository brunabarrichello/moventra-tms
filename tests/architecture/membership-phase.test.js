import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(root, 'db/migrations/0006_membership.sql');
const validationPath = path.join(root, 'db/validation/0006_membership_validation.sql');
const repositoryPath = path.join(
  root,
  'src/modules/identity/membership/membership-repository.js',
);

function executableSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

test('phase 012 migration creates only Membership and no later security entities', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /CREATE\s+TABLE\s+identity\.memberships/i);

  for (const table of [
    'external_identities',
    'auth_accounts',
    'credentials',
    'sessions',
    'roles',
    'permissions',
    'role_assignments',
    'audit_logs',
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+[a-z0-9_.]*${table}\\b`, 'i'),
      `phase 012 must not create later-phase table ${table}`,
    );
  }

  assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
});

test('phase 012 Membership keeps tenant/User boundary without Company or Branch scope', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /tenant_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(migration, /user_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(
    migration,
    /FOREIGN\s+KEY\s*\(\s*tenant_id\s*\)\s*REFERENCES\s+organization\.tenants\s*\(\s*id\s*\)/i,
  );
  assert.match(
    migration,
    /FOREIGN\s+KEY\s*\(\s*user_id\s*\)\s*REFERENCES\s+identity\.users\s*\(\s*id\s*\)/i,
  );
  assert.match(
    migration,
    /CONSTRAINT\s+uq_memberships_tenant_id_id\s+UNIQUE\s*\(\s*tenant_id\s*,\s*id\s*\)/i,
  );
  assert.match(
    migration,
    /CONSTRAINT\s+uq_memberships_tenant_user\s+UNIQUE\s*\(\s*tenant_id\s*,\s*user_id\s*\)/i,
  );
  assert.doesNotMatch(migration, /\bcompany_id\b/i);
  assert.doesNotMatch(migration, /\bbranch_id\b/i);
});

test('phase 012 lifecycle and optimistic locking are encoded in migration', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']) {
    assert.ok(migration.includes(`'${status}'`), `missing Membership lifecycle status ${status}`);
  }

  assert.match(migration, /id\s+UUID\s+NOT\s+NULL\s+DEFAULT\s+uuidv7\s*\(\s*\)/i);
  assert.match(migration, /version\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
  assert.match(migration, /CREATE\s+INDEX\s+ix_memberships_tenant_status/i);
  assert.match(migration, /CREATE\s+INDEX\s+ix_memberships_user_status/i);
});

test('phase 012 repository is tenant-scoped and atomically revalidates activation parents', async () => {
  const repository = await readFile(repositoryPath, 'utf8');

  assert.match(repository, /async create\(tenantId, userId\)/);
  assert.match(repository, /async findById\(tenantId, id\)/);
  assert.match(repository, /async findByUserId\(tenantId, userId\)/);
  assert.match(repository, /async transitionStatus\(tenantId, id, toStatus, expectedVersion\)/);
  assert.match(repository, /m\.tenant_id = \$1/);
  assert.match(repository, /organization\.tenants/);
  assert.match(repository, /identity\.users/);
  assert.match(repository, /t\.status = 'ACTIVE'/);
  assert.match(repository, /u\.status = 'ACTIVE'/);
});

test('phase 012 validation checks physical contract and migration history', async () => {
  const validation = await readFile(validationPath, 'utf8');

  assert.match(validation, /to_regclass\('identity\.memberships'\)/);
  assert.match(validation, /fk_memberships_tenant_id/);
  assert.match(validation, /fk_memberships_user_id/);
  assert.match(validation, /uq_memberships_tenant_id_id/);
  assert.match(validation, /uq_memberships_tenant_user/);
  assert.match(validation, /version\s*=\s*6/);
  assert.match(validation, /name\s*=\s*'0006_membership\.sql'/);
});
