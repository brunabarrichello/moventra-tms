import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresExternalIdentityRepository } from '../../src/modules/identity/auth/external-identity-repository.js';
const id='0198f1c0-4234-7abc-8def-0123456789ab';
const userId='0198f1c0-4234-7abc-8def-0123456789ac';
const row={id,user_id:userId,provider_key:'oidc',issuer:'https://issuer.example',subject:'subject-1',status:'ACTIVE',created_at:new Date(),updated_at:new Date(),version:'1'};
test('repository creates normalized external identity',async()=>{
 const calls=[]; const repo=new PostgresExternalIdentityRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[row]}}});
 const result=await repo.create({userId,providerKey:'OIDC',issuer:'https://issuer.example',subject:'subject-1'});
 assert.equal(result.providerKey,'oidc'); assert.deepEqual(calls[0].values,[userId,'oidc','https://issuer.example','subject-1','ACTIVE']);
});
test('provider subject lookup is isolated by provider and issuer',async()=>{
 const calls=[]; const repo=new PostgresExternalIdentityRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[row]}}});
 await repo.findByProviderSubject('oidc','https://issuer.example','subject-1');
 assert.deepEqual(calls[0].values,['oidc','https://issuer.example','subject-1']);
});
test('identity conflict is mapped',async()=>{
 const repo=new PostgresExternalIdentityRepository({query:async()=>{const e=new Error('dup');e.code='23505';e.constraint='uq_external_identities_provider_issuer_subject';throw e;}});
 await assert.rejects(()=>repo.create({userId,providerKey:'oidc',issuer:'https://issuer.example',subject:'subject-1'}),e=>e.code==='MVT_AUTH_EXTERNAL_IDENTITY_CONFLICT');
});
