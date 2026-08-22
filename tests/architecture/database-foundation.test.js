import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDirectory = path.join(root, 'db/migrations');
const validationDirectory = path.join(root, 'db/validation');
const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/;

const forbiddenPhaseSixIdentifiers = [
  'organization.tenants',
  'organization.companies',
  'organization.branches',
  'identity.users',
  'identity.user_identities',
  'identity.memberships',
  'identity.permissions',
  'identity.roles',
  'identity.role_permissions',
  'identity.membership_roles',
  'audit.audit_logs',
];

test('database migrations are ordered, paired with validation and non-empty', async () => {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const versions = new Set();

  assert.ok(migrationFiles.length > 0, 'at least one migration is required');

  for (const filename of migrationFiles) {
    const match = migrationPattern.exec(filename);
    assert.ok(match, `invalid migration filename: ${filename}`);
    assert.ok(!versions.has(match[1]), `duplicate migration version: ${match[1]}`);
    versions.add(match[1]);

    const migration = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    assert.ok(migration.trim().length > 0, `empty migration: ${filename}`);

    const validationFilename = filename.replace(/\.sql$/, '_validation.sql');
    const validation = await readFile(path.join(validationDirectory, validationFilename), 'utf8');
    assert.ok(validation.trim().length > 0, `empty validation: ${validationFilename}`);
  }
});

test('phase 006 foundation migration does not create later-phase domain entities', async () => {
  const migration = (
    await readFile(path.join(migrationsDirectory, '0001_foundation.sql'), 'utf8')
  ).toLowerCase();

  for (const identifier of forbiddenPhaseSixIdentifiers) {
    assert.ok(
      !migration.includes(identifier),
      `phase 006 migration must not contain later-phase entity ${identifier}`,
    );
  }

  assert.match(migration, /moventra_meta\.database_contract/);
  assert.doesNotMatch(migration, /create\s+schema\s+(if\s+not\s+exists\s+)?organization/i);
  assert.doesNotMatch(migration, /create\s+schema\s+(if\s+not\s+exists\s+)?identity/i);
  assert.doesNotMatch(migration, /create\s+schema\s+(if\s+not\s+exists\s+)?audit/i);
});

test('migration runner keeps database credentials out of command arguments', async () => {
  const runner = await readFile(path.join(root, 'scripts/db/migrate.mjs'), 'utf8');

  assert.match(runner, /delete environment\.DATABASE_URL/);
  assert.match(runner, /environment\.PGPASSWORD/);
  assert.doesNotMatch(runner, /spawnSync\('psql',[\s\S]*databaseUrl/);
});
