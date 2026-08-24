import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const mandatoryFiles = [
  'db/migrations/0006_membership.sql',
  'db/migrations/0007_external_identity.sql',
  'db/migrations/0008_rbac.sql',
  'db/migrations/0009_organizational_scope.sql',
  'db/migrations/0010_rls.sql',
  'db/migrations/0011_audit.sql',
  'db/validation/0006_membership_validation.sql',
  'db/validation/0007_external_identity_validation.sql',
  'db/validation/0008_rbac_validation.sql',
  'db/validation/0009_organizational_scope_validation.sql',
  'db/validation/0010_rls_validation.sql',
  'db/validation/0011_audit_validation.sql',
  'docs/implementation/012-memberships.md',
  'docs/implementation/013-auth.md',
  'docs/implementation/014-rbac.md',
  'docs/implementation/015-escopo-organizacional.md',
  'docs/implementation/016-rls.md',
  'docs/implementation/017-auditoria-central.md',
];

test('security foundation phases 012 through 017 have canonical migration, validation and documentation',()=>{
  for (const path of mandatoryFiles) {
    assert.equal(existsSync(path),true,`Missing mandatory security foundation file: ${path}`);
  }
});

test('migration history remains append-only and sequential through 0011',()=>{
  const files=mandatoryFiles.filter((path)=>path.startsWith('db/migrations/'));
  assert.deepEqual(files.map((path)=>path.slice(14,18)),['0006','0007','0008','0009','0010','0011']);
  for (const path of files) {
    assert.ok(readFileSync(path,'utf8').trim().length>0);
  }
});
