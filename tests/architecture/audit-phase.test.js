import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync('db/migrations/0011_audit.sql','utf8');
test('central audit is append-only, tenant-aware and indexed',()=>{
  assert.match(migration,/CREATE TABLE audit\.audit_events/);
  assert.match(migration,/tenant_id UUID NOT NULL/);
  assert.doesNotMatch(migration,/tenant_id UUID NULL/);
  assert.match(migration,/BEFORE UPDATE OR DELETE ON audit\.audit_events/);
  assert.match(migration,/ALTER TABLE audit\.audit_events ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/CREATE POLICY tenant_isolation_audit_events/);
  assert.match(migration,/ix_audit_events_tenant_occurred/);
  assert.match(migration,/ix_audit_events_correlation/);
});
test('audit schema carries actor and organizational coherence',()=>{
  assert.match(migration,/FOREIGN KEY \(tenant_id, actor_membership_id\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id, company_id, branch_id\)/);
  assert.match(migration,/before_data JSONB/);
  assert.match(migration,/after_data JSONB/);
});
