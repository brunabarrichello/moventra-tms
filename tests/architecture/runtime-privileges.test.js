import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync('scripts/db/runtime-privileges.mjs', 'utf8');
const validation = readFileSync('db/validation/runtime_privileges_validation.sql', 'utf8');

test('runtime privilege contract grants only the approved schemas and operations', () => {
  for (const schema of ['organization', 'identity', 'security', 'audit']) {
    assert.match(script, new RegExp(`USAGE ON SCHEMA[^;]*${schema}`));
  }

  assert.match(script, /SELECT, INSERT, UPDATE ON TABLE organization\.tenants, organization\.companies, organization\.branches/);
  assert.match(script, /SELECT, INSERT, UPDATE ON TABLE identity\.users, identity\.memberships, identity\.external_identities/);
  assert.match(script, /SELECT ON TABLE security\.permissions/);
  assert.match(script, /SELECT, INSERT, UPDATE ON TABLE security\.roles, security\.membership_roles, security\.organizational_scopes/);
  assert.match(script, /SELECT, INSERT, DELETE ON TABLE security\.role_permissions, security\.role_assignment_scopes/);
  assert.match(script, /SELECT, INSERT ON TABLE audit\.audit_events/);
  assert.match(script, /EXECUTE ON FUNCTION security\.current_tenant_id\(\)/);

  assert.doesNotMatch(script, /GRANT\s+ALL/i);
  assert.doesNotMatch(script, /BYPASSRLS/i);
  assert.doesNotMatch(script, /SUPERUSER/i);
  assert.doesNotMatch(script, /UPDATE, DELETE ON TABLE audit\.audit_events/i);
});

test('runtime role input is mandatory and identifier-safe', () => {
  assert.match(script, /RUNTIME_DATABASE_ROLE is required/);
  assert.match(script, /\^\[a-z_\]\[a-z0-9_\]\{0,62\}\$/);
  assert.doesNotMatch(script, /process\.argv/);
});

test('database validation mirrors the runtime least-privilege contract', () => {
  assert.match(validation, /CREATE ROLE moventra_runtime_ci_contract/);
  assert.match(validation, /NOBYPASSRLS/);
  assert.match(validation, /NOLOGIN/);
  assert.match(validation, /permission catalog must be SELECT-only for runtime/);
  assert.match(validation, /audit runtime privilege contract is invalid/);
  assert.match(validation, /REVOKE USAGE ON SCHEMA organization, identity, security, audit FROM moventra_runtime_ci_contract/);
  assert.doesNotMatch(validation, /DROP OWNED BY/);
  assert.match(validation, /DROP ROLE moventra_runtime_ci_contract/);
});
