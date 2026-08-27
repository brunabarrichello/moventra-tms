import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString = requiredText(
  process.env.RELEASE_SMOKE_DATABASE_URL,
  'RELEASE_SMOKE_DATABASE_URL',
);
assertSecurePostgresUrl(connectionString);

const db = new Client({ connectionString });
await db.connect();
try {
  const identity = await db.query(`
    SELECT
      current_user::text AS current_user_name,
      session_user::text AS session_user_name,
      current_setting('row_security', true) AS row_security,
      security.current_tenant_id()::text AS tenant_id,
      r.rolsuper,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolbypassrls
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  assert.equal(identity.rowCount, 1, 'release-smoke principal must resolve exactly one PostgreSQL role');

  const principal = identity.rows[0];
  assert.equal(principal.rolsuper, false, 'release-smoke principal must not be superuser');
  assert.equal(principal.rolcreaterole, false, 'release-smoke principal must not create roles');
  assert.equal(principal.rolcreatedb, false, 'release-smoke principal must not create databases');
  assert.equal(principal.rolbypassrls, false, 'release-smoke principal must not bypass RLS');
  assert.notEqual(principal.row_security, 'off', 'release-smoke principal must keep row_security enabled');
  assert.match(principal.tenant_id || '', /^[0-9a-f-]{36}$/i, 'release-smoke tenant context is required');

  const tenant = await db.query(
    `SELECT code
       FROM organization.tenants
      WHERE id = security.current_tenant_id()`,
  );
  assert.equal(tenant.rowCount, 1, 'release-smoke tenant context must resolve an existing tenant');
  assert.equal(
    tenant.rows[0].code,
    'staging-dlq-smoke',
    'release-smoke tenant must be the dedicated staging fixture tenant',
  );

  const schemas = ['organization', 'identity', 'security', 'audit', 'idempotency', 'outbox', 'dlq'];
  for (const schema of schemas) {
    const privileges = await db.query(
      `SELECT
         has_schema_privilege(current_user, $1, 'USAGE') AS usage,
         has_schema_privilege(current_user, $1, 'CREATE') AS create`,
      [schema],
    );
    assert.equal(privileges.rows[0].usage, true, `release-smoke principal requires USAGE on schema ${schema}`);
    assert.equal(privileges.rows[0].create, false, `release-smoke principal must not CREATE in schema ${schema}`);
  }

  const requiredTablePrivileges = [
    ['organization.tenants', ['SELECT', 'INSERT', 'UPDATE']],
    ['identity.users', ['SELECT', 'INSERT', 'UPDATE']],
    ['identity.memberships', ['SELECT', 'INSERT', 'UPDATE']],
    ['identity.external_identities', ['SELECT', 'INSERT', 'DELETE']],
    ['security.permissions', ['SELECT']],
    ['security.roles', ['SELECT', 'INSERT', 'UPDATE']],
    ['security.role_permissions', ['SELECT', 'INSERT']],
    ['security.membership_roles', ['SELECT', 'INSERT', 'UPDATE']],
    ['security.organizational_scopes', ['SELECT', 'INSERT']],
    ['security.role_assignment_scopes', ['SELECT', 'INSERT']],
    ['idempotency.records', ['SELECT', 'DELETE']],
    ['outbox.events', ['SELECT', 'INSERT', 'DELETE']],
    ['dlq.entries', ['SELECT', 'INSERT', 'DELETE']],
    ['audit.audit_events', ['SELECT']],
  ];

  for (const [table, privileges] of requiredTablePrivileges) {
    for (const privilege of privileges) {
      const allowed = await db.query(
        `SELECT has_table_privilege(current_user, $1, $2) AS allowed`,
        [table, privilege],
      );
      assert.equal(
        allowed.rows[0].allowed,
        true,
        `release-smoke principal requires ${privilege} on ${table}`,
      );
    }
  }

  const functionPrivilege = await db.query(
    `SELECT has_function_privilege(current_user, 'security.current_tenant_id()', 'EXECUTE') AS allowed`,
  );
  assert.equal(
    functionPrivilege.rows[0].allowed,
    true,
    'release-smoke principal requires EXECUTE on security.current_tenant_id()',
  );

  const rlsTables = [
    'organization.tenants',
    'identity.memberships',
    'security.roles',
    'security.role_permissions',
    'security.membership_roles',
    'security.organizational_scopes',
    'security.role_assignment_scopes',
    'audit.audit_events',
    'idempotency.records',
    'outbox.events',
    'dlq.entries',
  ];
  const rls = await db.query(
    `SELECT n.nspname || '.' || c.relname AS table_name, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname || '.' || c.relname = ANY($1::text[])`,
    [rlsTables],
  );
  assert.equal(rls.rowCount, rlsTables.length, 'release-smoke RLS table inventory is incomplete');
  for (const row of rls.rows) {
    assert.equal(row.relrowsecurity, true, `RLS must remain enabled on ${row.table_name}`);
  }

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    principalSha256: sha256(principal.current_user_name),
    sessionPrincipalSha256: sha256(principal.session_user_name),
    tenantIdSha256: sha256(principal.tenant_id),
    rowSecurity: principal.row_security !== 'off',
    superuser: false,
    bypassRls: false,
    fixturePrivileges: true,
  })}\n`);
} finally {
  await db.end().catch(() => {});
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function assertSecurePostgresUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('RELEASE_SMOKE_DATABASE_URL must use postgres/postgresql');
  }
  if (!url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('RELEASE_SMOKE_DATABASE_URL must include host and database');
  }
  if (url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('RELEASE_SMOKE_DATABASE_URL must explicitly use sslmode=verify-full');
  }
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}
