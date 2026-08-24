import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeScopeTarget, scopeCovers } from '../../src/modules/security/scope/organizational-scope-domain.js';

const company='0198f1c0-4234-7abc-8def-0123456789ab';
const branch='0198f1c0-4234-7abc-8def-0123456789ac';

test('scope shapes are explicit',()=>{
  assert.deepEqual(normalizeScopeTarget({level:'tenant'}),{level:'TENANT',companyId:null,branchId:null});
  assert.deepEqual(normalizeScopeTarget({level:'company',companyId:company}),{level:'COMPANY',companyId:company,branchId:null});
  assert.deepEqual(normalizeScopeTarget({level:'branch',companyId:company,branchId:branch}),{level:'BRANCH',companyId:company,branchId:branch});
});
test('tenant covers all, company covers its branch, branch is exact',()=>{
  assert.equal(scopeCovers({level:'TENANT'},{level:'BRANCH',companyId:company,branchId:branch}),true);
  assert.equal(scopeCovers({level:'COMPANY',companyId:company},{level:'BRANCH',companyId:company,branchId:branch}),true);
  assert.equal(scopeCovers({level:'BRANCH',companyId:company,branchId:branch},{level:'COMPANY',companyId:company}),false);
});
