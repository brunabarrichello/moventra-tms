import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync('db/migrations/0010_rls.sql','utf8');
test('phase 016 enables RLS only on tenant-scoped structures',()=>{
  for (const table of ['organization.tenants','organization.companies','organization.branches','identity.memberships','security.roles','security.role_permissions','security.membership_roles','security.organizational_scopes','security.role_assignment_scopes']) {
    assert.match(migration,new RegExp(`ALTER TABLE ${table.replace('.','\\.')} ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(migration,/ALTER TABLE identity\.users ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration,/ALTER TABLE identity\.external_identities ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration,/ALTER TABLE security\.permissions ENABLE ROW LEVEL SECURITY/);
});
test('RLS policy derives tenant only from transaction-local setting',()=>{
  assert.match(migration,/current_setting\('moventra\.tenant_id', true\)/);
  assert.match(migration,/WITH CHECK \(tenant_id = security\.current_tenant_id\(\)\)/);
  assert.doesNotMatch(migration,/FORCE ROW LEVEL SECURITY/);
});
