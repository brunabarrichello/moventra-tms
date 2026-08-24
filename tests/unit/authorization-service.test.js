import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationService } from '../../src/modules/security/rbac/authorization-service.js';

test('authorization service returns true only when repository grants permission',async()=>{
  const service=new AuthorizationService({rbac:{hasPermission:async()=>true}});
  assert.equal(await service.requirePermission({tenantId:'x',membershipId:'y',permission:'operations.trip.read'}),true);
});
test('authorization service denies by default when permission is absent',async()=>{
  const service=new AuthorizationService({rbac:{hasPermission:async()=>false}});
  await assert.rejects(()=>service.requirePermission({tenantId:'x',membershipId:'y',permission:'finance.payment.approve'}),e=>e.code==='MVT_RBAC_FORBIDDEN');
});
