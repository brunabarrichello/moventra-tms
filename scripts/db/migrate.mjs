import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const MIGRATION_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_NAMESPACE = 6006;
const SAFE_ROLE_OPTION_PATTERN = /^-c\s+role=([a-z_][a-z0-9_]{0,62})$/;
const root = process.cwd();
const migrationsDirectory = resolve(root, 'db/migrations');
const statusOnly = process.argv.includes('--status');

const connectionEnvironment = buildConnectionEnvironment();
const migrations = loadMigrations();

bootstrapMigrationMetadata();

let appliedCount = 0;
let skippedCount = 0;

for (const migration of migrations) {
  const existing = readAppliedMigration(migration.version);

  if (existing) {
    if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
      throw new Error(
        `Migration ${migration.version} was modified after application: ${migration.name}`,
      );
    }

    skippedCount += 1;
    process.stdout.write(`migration ${migration.version} already applied: ${migration.name}\n`);
    continue;
  }

  if (statusOnly) {
    process.stdout.write(`migration ${migration.version} pending: ${migration.name}\n`);
    continue;
  }

  applyMigration(migration);
  appliedCount += 1;
  process.stdout.write(`migration ${migration.version} applied: ${migration.name}\n`);
}

process.stdout.write(
  `migration summary: applied=${appliedCount} existing=${skippedCount} total=${migrations.length}\n`,
);

function buildConnectionEnvironment() {
  const environment = { ...process.env };
  const databaseUrl = environment.DATABASE_URL;
  delete environment.DATABASE_URL;
  delete environment.PGOPTIONS;

  if (databaseUrl) {
    const parsed = new URL(databaseUrl);

    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
    }

    if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
      throw new Error('DATABASE_URL must include host and database name');
    }

    environment.PGHOST = parsed.hostname;
    environment.PGPORT = parsed.port || '5432';
    environment.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
    environment.PGUSER = decodeURIComponent(parsed.username);
    environment.PGPASSWORD = decodeURIComponent(parsed.password);

    const sslMode = parsed.searchParams.get('sslmode');
    const channelBinding = parsed.searchParams.get('channel_binding');
    const options = parsed.searchParams.get('options');

    if (sslMode) {
      environment.PGSSLMODE = sslMode;
    }

    if (channelBinding) {
      environment.PGCHANNELBINDING = channelBinding;
    }

    if (options) {
      const roleOption = SAFE_ROLE_OPTION_PATTERN.exec(options);

      if (!roleOption) {
        throw new Error('DATABASE_URL options only supports -c role=<safe_role_name>');
      }

      environment.PGOPTIONS = `-c role=${roleOption[1]}`;
    }
  }

  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER']) {
    if (!environment[key]) {
      throw new Error(`DATABASE_URL or ${key} connection settings are required`);
    }
  }

  environment.PGPORT ||= '5432';
  environment.PGAPPNAME = 'moventra-migrations';

  return environment;
}

function loadMigrations() {
  const seenVersions = new Set();

  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = MIGRATION_PATTERN.exec(entry.name);

      if (!match) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }

      const version = Number.parseInt(match[1], 10);

      if (seenVersions.has(version)) {
        throw new Error(`Duplicate migration version: ${match[1]}`);
      }

      seenVersions.add(version);

      const path = resolve(migrationsDirectory, entry.name);
      const sql = readFileSync(path, 'utf8');

      if (!sql.trim()) {
        throw new Error(`Migration is empty: ${entry.name}`);
      }

      return {
        version,
        name: basename(path),
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
        sql,
      };
    })
    .sort((left, right) => left.version - right.version);
}

function bootstrapMigrationMetadata() {
  runPsqlQuery(`
    CREATE SCHEMA IF NOT EXISTS moventra_meta;

    CREATE TABLE IF NOT EXISTS moventra_meta.schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      applied_by TEXT NOT NULL DEFAULT current_user,
      CONSTRAINT ck_schema_migrations_checksum
        CHECK (checksum ~ '^[0-9a-f]{64}$')
    );

    COMMENT ON TABLE moventra_meta.schema_migrations IS
      'Moventra TMS immutable migration history with SHA-256 checksums.';
  `);
}

function readAppliedMigration(version) {
  const output = runPsqlQuery(`
    SELECT name || '|' || checksum
    FROM moventra_meta.schema_migrations
    WHERE version = ${version};
  `).trim();

  if (!output) {
    return null;
  }

  const separator = output.indexOf('|');

  if (separator < 1) {
    throw new Error(`Invalid migration history row for version ${version}`);
  }

  return {
    name: output.slice(0, separator),
    checksum: output.slice(separator + 1),
  };
}

function applyMigration(migration) {
  const migrationName = sqlLiteral(migration.name);
  const checksum = sqlLiteral(migration.checksum);
  const script = `
BEGIN;
SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${migration.version});

DO $concurrency_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM moventra_meta.schema_migrations
    WHERE version = ${migration.version}
  ) THEN
    RAISE EXCEPTION 'migration ${migration.version} was applied concurrently';
  END IF;
END
$concurrency_guard$;

${migration.sql}

INSERT INTO moventra_meta.schema_migrations (version, name, checksum)
VALUES (${migration.version}, ${migrationName}, ${checksum});
COMMIT;
`;

  runPsqlScript(script);
}

function runPsqlQuery(sql) {
  return runPsql(['-X', '--no-psqlrc', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
}

function runPsqlScript(sql) {
  return runPsql(['-X', '--no-psqlrc', '-q', '-v', 'ON_ERROR_STOP=1'], sql);
}

function runPsql(args, input) {
  const result = spawnSync('psql', args, {
    cwd: root,
    env: connectionEnvironment,
    encoding: 'utf8',
    input,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('psql is required to run migrations');
    }

    throw result.error;
  }

  if (result.status !== 0) {
    const errorOutput = result.stderr.trim() || 'psql exited with a non-zero status';
    throw new Error(errorOutput);
  }

  return result.stdout;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
