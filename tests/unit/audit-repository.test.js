import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresAuditRepository } from '../../src/modules/audit/audit-repository.js';

const tenant='0198f1c0-4234-7abc-8def-0123456789ab';
test('audit repository exposes append only and persists redacted JSON',async()=>{
  const calls=[];
  const repository=new PostgresAuditRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[{id:'0198f1c0-4234-7abc-8def-0123456789ac',occurred_at:new Date()}]};}});
  const saved=await repository.append({tenantId:tenant,category:'security',action:'rbac.deny',entityType:'trip',outcome:'DENIED',metadata:{access_token:'secret',safe:true}});
  assert.ok(saved.id);
  assert.match(calls[0].text,/INSERT INTO audit\.audit_events/);
  assert.doesNotMatch(calls[0].text,/UPDATE|DELETE/);
  assert.match(calls[0].values.at(-1),/\[REDACTED\]/);
});
test('audit repository has no mutation methods',()=>{
  const repository=new PostgresAuditRepository({query:async()=>({rows:[]})});
  assert.equal(repository.update,undefined);
  assert.equal(repository.delete,undefined);
});
