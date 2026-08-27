import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  BearerJwtAssertionVerifier,
  createRuntimeBearerJwtAssertionVerifier,
} from '../../src/http/bearer-jwt-assertion.js';

function rsaFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://identity.example.test';
  const audience = 'moventra-admin';
  const now = 1_800_000_000;
  const verifier = new BearerJwtAssertionVerifier({
    providerKey: 'test-idp', issuer, audience,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    clock: () => now,
  });
  return { privateKey, issuer, audience, now, verifier };
}

function jwt(privateKey, claims, header = { alg: 'RS256', typ: 'JWT' }, digest = 'RSA-SHA256') {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${encodedHeader}.${encodedClaims}`;
  const signature = sign(digest, Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

function corruptJwtSignature(token) {
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const signature = Buffer.from(parts[2], 'base64url');
  assert.ok(signature.length > 0);
  const corrupted = Buffer.from(signature);
  corrupted[0] ^= 0x01;
  return `${parts[0]}.${parts[1]}.${corrupted.toString('base64url')}`;
}

test('JWT bearer verifies static PEM signature and returns only trusted external identity tuple', async () => {
  const { privateKey, issuer, audience, now, verifier } = rsaFixture();
  const token = jwt(privateKey, { iss: issuer, aud: audience, sub: 'operator-123', iat: now - 10, exp: now + 300 });
  assert.deepEqual(await verifier.verifyRequest({ headers: { authorization: `Bearer ${token}` } }), {
    providerKey: 'test-idp', issuer, subject: 'operator-123',
  });
});

test('JWT bearer rejects forged, expired and wrong-audience tokens', async () => {
  const { privateKey, issuer, audience, now, verifier } = rsaFixture();
  const claims = { iss: issuer, aud: audience, sub: 'operator-123', exp: now + 300 };
  const valid = jwt(privateKey, claims);
  const forged = corruptJwtSignature(valid);
  await assert.rejects(verifier.verifyToken(forged), (error) => error.category === 'AUTHENTICATION');
  await assert.rejects(verifier.verifyToken(jwt(privateKey, { ...claims, exp: now - 120 })), (error) => error.category === 'AUTHENTICATION');
  await assert.rejects(verifier.verifyToken(jwt(privateKey, { ...claims, aud: 'other-api' })), (error) => error.category === 'AUTHENTICATION');
});

test('remote JWKS verifies Ed25519 token by kid and caches the trusted public key set', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const issuer = 'https://managed-auth.example.test/auth';
  const audience = issuer;
  const now = 1_800_000_000;
  let fetchCalls = 0;
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'managed-key-1';
  const fetchImpl = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ keys: [{ ...jwk, kid, alg: 'EdDSA', use: 'sig' }] }),
    };
  };
  const verifier = new BearerJwtAssertionVerifier({
    providerKey: 'managed-auth', issuer, audience, algorithm: 'EdDSA',
    jwksUrl: `${issuer}/.well-known/jwks.json`, fetchImpl,
    clock: () => now, clockMs: () => now * 1000,
  });
  const claims = { iss: issuer, aud: audience, sub: 'user-456', iat: now - 1, exp: now + 300 };
  const token = jwt(privateKey, claims, { alg: 'EdDSA', typ: 'JWT', kid }, null);

  assert.deepEqual(await verifier.verifyToken(token), {
    providerKey: 'managed-auth', issuer, subject: 'user-456',
  });
  assert.deepEqual(await verifier.verifyToken(token), {
    providerKey: 'managed-auth', issuer, subject: 'user-456',
  });
  assert.equal(fetchCalls, 1);
});

test('remote JWKS fails closed when kid is unknown or provider is unavailable', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const issuer = 'https://managed-auth.example.test/auth';
  const now = 1_800_000_000;
  const token = jwt(privateKey, { iss: issuer, aud: issuer, sub: 'user', exp: now + 300 }, {
    alg: 'EdDSA', typ: 'JWT', kid: 'missing-key',
  }, null);
  const unknown = new BearerJwtAssertionVerifier({
    providerKey: 'managed-auth', issuer, audience: issuer, algorithm: 'EdDSA',
    jwksUrl: `${issuer}/.well-known/jwks.json`, clock: () => now,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ keys: [{
      kty: 'OKP', crv: 'Ed25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', kid: 'other-key', alg: 'EdDSA', use: 'sig',
    }] }) }),
  });
  await assert.rejects(unknown.verifyToken(token), (error) => error.category === 'AUTHENTICATION');

  const unavailable = new BearerJwtAssertionVerifier({
    providerKey: 'managed-auth', issuer, audience: issuer, algorithm: 'EdDSA',
    jwksUrl: `${issuer}/.well-known/jwks.json`, clock: () => now,
    fetchImpl: async () => { throw new Error('network unavailable'); },
  });
  await assert.rejects(unavailable.verifyToken(token), (error) => error.category === 'DEPENDENCY' && error.retryable === true);
});

test('runtime JWT adapter fails closed when provider configuration is absent', async () => {
  const verifier = createRuntimeBearerJwtAssertionVerifier({});
  await assert.rejects(verifier.verifyRequest({ headers: {} }), (error) => error.category === 'DEPENDENCY' && error.retryable === false);
});
