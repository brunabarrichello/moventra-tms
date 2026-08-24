import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePermission, normalizePermissionCode, normalizeRole } from '../../src/modules/security/rbac/rbac-domain.js';

test('permission code is canonical business action',()=>{
  assert.equal(normalizePermission({code:' Finance.Payment.Approve ',description:'Approve payment'}).code,'finance.payment.approve');
  assert.equal(normalizePermissionCode('Operations.Trip.Read'),'operations.trip.read');
});
test('role code is normalized and tenant-independent in domain input',()=>{
  assert.deepEqual(normalizeRole({code:'Dispatcher',name:'Dispatcher'}),{code:'dispatcher',name:'Dispatcher',description:null,status:'ACTIVE'});
});
test('invalid permission code is rejected',()=>{
  assert.throws(()=>normalizePermissionCode('ADMIN:*'),e=>e.code==='MVT_RBAC_PERMISSION_CODE_INVALID');
});
