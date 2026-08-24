import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('db/migrations/0008_rbac.sql', 'utf8');

test('phase 014 materializes tenant-aware RBAC without organizational scope anticipation', () => {
  assert.match(migration, /CREATE TABLE security\.permissions/);
  assert.match(migration, /CREATE TABLE security\.roles/);
  assert.match(migration, /CREATE TABLE security\.role_permissions/);
  assert.match(migration, /CREATE TABLE security\.membership_roles/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, membership_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, role_id\)/);
  assert.doesNotMatch(migration, /company_id|branch_id|CREATE POLICY|audit_events/i);
});

test('permission catalog remains global while grants are tenant-scoped', () => {
  const permissionTable = migration.slice(
    migration.indexOf('CREATE TABLE security.permissions'),
    migration.indexOf('CREATE TABLE security.roles'),
  );
  assert.doesNotMatch(permissionTable, /tenant_id/);
  assert.match(migration, /UNIQUE \(tenant_id, code\)/);
});
