import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthIdentityResolver } from '../../src/modules/identity/auth/auth-identity-resolver.js';
const user={id:'0198f1c0-4234-7abc-8def-0123456789ab',status:'ACTIVE'};
const identity={id:'0198f1c0-4234-7abc-8def-0123456789ac',userId:user.id,status:'ACTIVE'};
const membership={id:'0198f1c0-4234-7abc-8def-0123456789ad',userId:user.id,status:'ACTIVE'};
const assertion={providerKey:'oidc',issuer:'https://issuer.example',subject:'sub'};
test('resolver requires active external identity, user and tenant membership',async()=>{
 const resolver=new AuthIdentityResolver({externalIdentities:{findByProviderSubject:async()=>identity},users:{findById:async()=>user},memberships:{findByUserId:async()=>membership}});
 const result=await resolver.resolveForTenant(assertion,'0198f1c0-4234-7abc-8def-0123456789ae');
 assert.equal(result.user.id,user.id); assert.equal(result.membership.status,'ACTIVE');
});
test('resolver denies missing membership in requested tenant',async()=>{
 const resolver=new AuthIdentityResolver({externalIdentities:{findByProviderSubject:async()=>identity},users:{findById:async()=>user},memberships:{findByUserId:async()=>null}});
 await assert.rejects(()=>resolver.resolveForTenant(assertion,'0198f1c0-4234-7abc-8def-0123456789ae'),e=>e.code==='MVT_AUTH_MEMBERSHIP_NOT_OPERATIONAL');
});
