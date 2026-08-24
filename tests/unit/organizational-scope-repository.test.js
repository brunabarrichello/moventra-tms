import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresOrganizationalScopeRepository } from '../../src/modules/security/scope/organizational-scope-repository.js';

const tenant='0198f1c0-4234-7abc-8def-0123456789ab';
const membership='0198f1c0-4234-7abc-8def-0123456789ac';
const company='0198f1c0-4234-7abc-8def-0123456789ad';
const branch='0198f1c0-4234-7abc-8def-0123456789ae';

test('scoped permission check is tenant-aware and matches hierarchy',async()=>{
  const calls=[];
  const repository=new PostgresOrganizationalScopeRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[{allowed:true}]};}});
  assert.equal(await repository.hasScopedPermission(tenant,membership,'Operations.Trip.Read',{level:'BRANCH',companyId:company,branchId:branch}),true);
  assert.deepEqual(calls[0].values,[tenant,membership,'operations.trip.read','BRANCH',company,branch]);
  assert.match(calls[0].text,/os\.scope_level = 'TENANT'/);
  assert.match(calls[0].text,/os\.scope_level = 'COMPANY'/);
  assert.match(calls[0].text,/os\.scope_level = 'BRANCH'/);
});
