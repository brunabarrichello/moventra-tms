import assert from 'node:assert/strict';
import test from 'node:test';
import { assertExternalIdentityTransition, normalizeExternalIdentityCreation, normalizeProviderKey } from '../../src/modules/identity/auth/external-identity-domain.js';

const userId='0198f1c0-4234-7abc-8def-0123456789ab';
test('external identity creation is provider agnostic and ACTIVE',()=>{
  assert.deepEqual(normalizeExternalIdentityCreation({userId,providerKey:' Entra.ID ',issuer:'https://login.example/tenant',subject:'abc-123'}),{userId,providerKey:'entra.id',issuer:'https://login.example/tenant',subject:'abc-123',status:'ACTIVE'});
});
test('invalid provider key is rejected',()=>assert.throws(()=>normalizeProviderKey('@@'),e=>e.code==='MVT_AUTH_PROVIDER_INVALID'));
test('identity can disable and re-enable only',()=>{
  assert.doesNotThrow(()=>assertExternalIdentityTransition('ACTIVE','DISABLED'));
  assert.doesNotThrow(()=>assertExternalIdentityTransition('DISABLED','ACTIVE'));
  assert.throws(()=>assertExternalIdentityTransition('ACTIVE','ACTIVE'),e=>e.code==='MVT_AUTH_IDENTITY_TRANSITION_INVALID');
});
