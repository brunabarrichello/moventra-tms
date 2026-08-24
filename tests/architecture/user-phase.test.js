import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(root, 'db/migrations/0005_user.sql');
const validationPath = path.join(root, 'db/validation/0005_user_validation.sql');
const repositoryPath = path.join(root, 'src/modules/identity/user/user-repository.js');

function executableSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

test('phase 011 migration creates only the global provider-agnostic User identity', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+identity/i);
  assert.match(migration, /CREATE\s+TABLE\s+identity\.users/i);

  const forbiddenTables = [
    'memberships',
    'invitations',
    'external_identities',
    'auth_accounts',
    'credentials',
    'passwords',
    'sessions',
    'roles',
    'permissions',
    'role_assignments',
    'audit_logs',
  ];

  for (const table of forbiddenTables) {
    assert.doesNotMatch(
      migration,
      new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+[a-z0-9_.]*${table}\\b`, 'i'),
      `phase 011 must not create later-phase table ${table}`,
    );
  }

  assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
});

test('phase 011 User remains global and independent of organization scope', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));
  const createTable = migration.match(/CREATE\s+TABLE\s+identity\.users\s*\(([\s\S]*?)\);/i)?.[1];

  assert.ok(createTable, 'identity.users CREATE TABLE body must exist');
  assert.doesNotMatch(createTable, /\btenant_id\b/i);
  assert.doesNotMatch(createTable, /\bcompany_id\b/i);
  assert.doesNotMatch(createTable, /\bbranch_id\b/i);
  assert.doesNotMatch(createTable, /\bprovider_subject\b|\bpassword_hash\b|\bsession_id\b/i);
});

test('phase 011 database contract encodes UUIDv7, canonical email and optimistic locking', async () => {
  const migration = executableSql(await readFile(migrationPath, 'utf8'));

  assert.match(migration, /id\s+UUID\s+NOT\s+NULL\s+DEFAULT\s+uuidv7\s*\(\s*\)/i);
  assert.match(
    migration,
    /CONSTRAINT\s+uq_users_primary_email\s+UNIQUE\s*\(\s*primary_email\s*\)/i,
  );
  assert.match(migration, /primary_email\s*=\s*lower\s*\(\s*btrim\s*\(\s*primary_email\s*\)\s*\)/i);
  assert.match(migration, /version\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+1/i);

  for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']) {
    assert.ok(migration.includes(`'${status}'`), `missing User lifecycle status ${status}`);
  }
});

test('phase 011 repository exposes only global User persistence operations', async () => {
  const repository = await readFile(repositoryPath, 'utf8');

  assert.match(repository, /async create\(input\)/);
  assert.match(repository, /async findById\(id\)/);
  assert.match(repository, /async findByPrimaryEmail\(primaryEmail\)/);
  assert.match(repository, /async updateProfile\(id, input, expectedVersion\)/);
  assert.match(repository, /async transitionStatus\(id, toStatus, expectedVersion\)/);
  assert.doesNotMatch(repository, /async findByTenant|async findByCompany|async findByBranch/);
  assert.doesNotMatch(repository, /providerSubject|passwordHash|sessionId/);
});

test('phase 011 validation checks global User contract and migration history', async () => {
  const validation = await readFile(validationPath, 'utf8');

  assert.match(validation, /to_regclass\('identity\.users'\)/);
  assert.match(validation, /uq_users_primary_email/);
  assert.match(validation, /tenant_id', 'company_id', 'branch_id/);
  assert.match(validation, /version\s*=\s*5/);
  assert.match(validation, /name\s*=\s*'0005_user\.sql'/);
});
