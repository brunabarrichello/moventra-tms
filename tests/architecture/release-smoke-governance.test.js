import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('staging DLQ smoke uses a dedicated release-smoke database credential', async () => {
  const workflow = await read('.github/workflows/release-gate.yml');
  const smoke = await read('scripts/release/smoke-dlq-admin.mjs');

  assert.match(workflow, /RELEASE_SMOKE_DATABASE_URL: \$\{\{ secrets\.RELEASE_SMOKE_DATABASE_URL \}\}/);
  assert.match(workflow, /Preflight staging release-smoke database principal/);
  assert.match(workflow, /preflight-release-smoke-db\.mjs/);
  assert.match(smoke, /process\.env\.RELEASE_SMOKE_DATABASE_URL/);
  assert.doesNotMatch(smoke, /process\.env\.MIGRATIONS_DATABASE_URL/);
});

test('release-smoke principal is fail-closed against DDL and RLS bypass', async () => {
  const preflight = await read('scripts/release/preflight-release-smoke-db.mjs');
  const access = await read('db/runtime/release-smoke-access.sql');

  assert.match(preflight, /rolsuper/);
  assert.match(preflight, /rolbypassrls/);
  assert.match(preflight, /row_security/);
  assert.match(preflight, /sslmode=verify-full/);
  assert.match(preflight, /fixturePrivileges: true/);
  assert.match(access, /REVOKE CREATE ON SCHEMA organization, identity, security, audit, idempotency, outbox, dlq/);
  assert.match(access, /GRANT EXECUTE ON FUNCTION security\.current_tenant_id\(\)/);
  assert.doesNotMatch(access, /BYPASSRLS/i);
});

test('release-smoke fixture remains pinned to the dedicated tenant through RLS', async () => {
  const smoke = await read('scripts/release/smoke-dlq-admin.mjs');
  const preflight = await read('scripts/release/preflight-release-smoke-db.mjs');

  assert.match(smoke, /security\.current_tenant_id\(\)::text AS tenant_id/);
  assert.match(smoke, /id, code, display_name, status, default_timezone, default_currency/);
  assert.match(smoke, /VALUES \(\$1, 'staging-dlq-smoke'/);
  assert.match(preflight, /staging-dlq-smoke/);
  assert.match(preflight, /audit\.audit_events/);
});

test('ephemeral Neon Auth user cleanup is governed by branch-scoped Neon control plane', async () => {
  const workflow = await read('.github/workflows/release-gate.yml');
  const smoke = await read('scripts/release/smoke-dlq-admin.mjs');

  assert.match(workflow, /NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}/);
  assert.match(workflow, /NEON_PROJECT_ID: \$\{\{ vars\.NEON_PROJECT_ID \}\}/);
  assert.match(workflow, /NEON_STAGING_BRANCH_ID: \$\{\{ vars\.NEON_STAGING_BRANCH_ID \}\}/);
  assert.match(smoke, /\/branches\/\$\{encodeURIComponent\(neonBranchId\)\}\/auth\/users\//);
  assert.match(smoke, /response\.status === 204/);
  assert.match(smoke, /response\.status === 423 \|\| response\.status === 503/);
  assert.match(workflow, /authUserCleanup/);
});

test('configuration contract declares release-smoke secrets without values', async () => {
  const env = await read('.env.example');

  assert.match(env, /^RELEASE_SMOKE_DATABASE_URL=$/m);
  assert.match(env, /^NEON_API_KEY=$/m);
  assert.match(env, /^NEON_PROJECT_ID=$/m);
  assert.match(env, /^NEON_STAGING_BRANCH_ID=$/m);
});
