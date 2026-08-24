import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresRbacRepository } from '../../src/modules/security/rbac/rbac-repository.js';

const tenant='0198f1c0-4234-7abc-8def-0123456789ab';
const membership='0198f1c0-4234-7abc-8def-0123456789ac';
const role='0198f1c0-4234-7abc-8def-0123456789ad';

test('permission check is tenant and membership scoped and validates operational chain',async()=>{
  const calls=[];
  const repo=new PostgresRbacRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[{allowed:true}]};}});
  assert.equal(await repo.hasPermission(tenant,membership,'Finance.Payment.Approve'),true);
  assert.deepEqual(calls[0].values,[tenant,membership,'finance.payment.approve']);
  assert.match(calls[0].text,/m\.tenant_id = \$1/);
  assert.match(calls[0].text,/m\.status = 'ACTIVE'/);
  assert.match(calls[0].text,/t\.status = 'ACTIVE'/);
  assert.match(calls[0].text,/u\.status = 'ACTIVE'/);
});

test('role assignment uses tenant-coherent membership and role keys',async()=>{
  const calls=[];
  const repo=new PostgresRbacRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[{id:'0198f1c0-4234-7abc-8def-0123456789ae',tenant_id:tenant,membership_id:membership,role_id:role,status:'ACTIVE',version:'1'}]};}});
  const result=await repo.assignRole(tenant,membership,role);
  assert.equal(result.status,'ACTIVE');
  assert.deepEqual(calls[0].values,[tenant,membership,role]);
});
