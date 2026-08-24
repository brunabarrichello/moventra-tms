import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuditEvent, sanitizeAuditObject } from '../../src/modules/audit/audit-domain.js';

const tenant='0198f1c0-4234-7abc-8def-0123456789ab';
const user='0198f1c0-4234-7abc-8def-0123456789ac';

test('audit payload redacts credentials recursively',()=>{
  assert.deepEqual(sanitizeAuditObject({authorization:'Bearer secret',nested:{refresh_token:'x',safe:'ok'}}),{authorization:'[REDACTED]',nested:{refresh_token:'[REDACTED]',safe:'ok'}});
});
test('audit event normalizes codes and preserves minimized context',()=>{
  const event=normalizeAuditEvent({tenantId:tenant,actorUserId:user,category:'Security',action:'RBAC.Deny',entityType:'Trip',entityId:'abc',outcome:'denied',metadata:{password:'secret',reasonCode:'missing_permission'}});
  assert.equal(event.category,'security');
  assert.equal(event.action,'rbac.deny');
  assert.equal(event.outcome,'DENIED');
  assert.equal(event.metadata.password,'[REDACTED]');
});
test('membership context without tenant is rejected',()=>{
  assert.throws(()=>normalizeAuditEvent({actorMembershipId:user,category:'security',action:'rbac.deny',entityType:'trip',outcome:'DENIED'}),e=>e.code==='MVT_AUDIT_SCOPE_INVALID');
});
