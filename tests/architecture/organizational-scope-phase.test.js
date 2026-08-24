import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync('db/migrations/0009_organizational_scope.sql','utf8');
test('phase 015 uses tenant-aware composite hierarchy FKs',()=>{
  assert.match(migration,/FOREIGN KEY \(tenant_id, company_id\) REFERENCES organization\.companies\(tenant_id, id\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id, company_id, branch_id\) REFERENCES organization\.branches\(tenant_id, company_id, id\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id, assignment_id\) REFERENCES security\.membership_roles\(tenant_id, id\)/);
  assert.doesNotMatch(migration,/CREATE POLICY|audit_events/i);
});
