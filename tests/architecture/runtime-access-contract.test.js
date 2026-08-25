import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contract = readFileSync('db/runtime/runtime-access.sql', 'utf8');
const validation = readFileSync('db/runtime/runtime-access-validation.sql', 'utf8');
const ciValidation = readFileSync('db/validation/0012_runtime_access_validation.sql', 'utf8');

test('runtime ACL contract is explicit and never grants broad ownership-like privileges', () => {
  assert.match(contract, /GRANT USAGE ON SCHEMA organization, identity, security, audit/);
  assert.match(contract, /REVOKE CREATE ON SCHEMA organization, identity, security, audit/);
  assert.match(contract, /REVOKE ALL PRIVILEGES ON SCHEMA moventra_meta/);
  assert.doesNotMatch(contract, /GRANT\s+ALL(?:\s+PRIVILEGES)?/i);
  assert.doesNotMatch(contract, /GRANT[^;]*\bDELETE\b/i);
  assert.doesNotMatch(contract, /BYPASSRLS|SUPERUSER|CREATEDB|CREATEROLE/i);
});

test('global permission catalog is read-only and audit is append-only for runtime', () => {
  assert.match(contract, /GRANT SELECT ON security\.permissions/);
  assert.match(contract, /REVOKE INSERT, UPDATE ON security\.permissions/);
  assert.match(contract, /GRANT INSERT ON audit\.audit_events/);
  assert.match(contract, /GRANT SELECT \(id, occurred_at\) ON audit\.audit_events/);
  assert.match(contract, /REVOKE UPDATE ON audit\.audit_events/);
});

test('validation uses a non-owner non-bypass role and proves negative boundaries', () => {
  assert.match(ciValidation, /NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(ciValidation, /LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(validation, /cross-tenant Tenant read was not isolated/);
  assert.match(validation, /cross-tenant membership write unexpectedly succeeded/);
  assert.match(validation, /permission catalog mutation unexpectedly succeeded/);
  assert.match(validation, /audit UPDATE unexpectedly succeeded/);
  assert.match(validation, /runtime unexpectedly read migration metadata/);
  assert.match(validation, /runtime unexpectedly created a table/);
});
