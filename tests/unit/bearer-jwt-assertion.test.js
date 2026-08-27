import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  BearerJwtAssertionVerifier,
  createRuntimeBearerJwtAssertionVerifier,
} from '../../src/http/bearer-jwt-assertion.js';

function fixture() {
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

function jwt(privateKey, claims, header = { alg: 'RS256', typ: 'JWT' }) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${encodedHeader}.${encodedClaims}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

test('JWT bearer verifies signature and returns only trusted external identity tuple', () => {
  const { privateKey, issuer, audience, now, verifier } = fixture();
  const token = jwt(privateKey, { iss: issuer, aud: audience, sub: 'operator-123', iat: now - 10, exp: now + 300 });
  assert.deepEqual(verifier.verifyRequest({ headers: { authorization: `Bearer ${token}` } }), {
    providerKey: 'test-idp', issuer, subject: 'operator-123',
  });
});

test('JWT bearer rejects forged, expired and wrong-audience tokens', () => {
  const { privateKey, issuer, audience, now, verifier } = fixture();
  const claims = { iss: issuer, aud: audience, sub: 'operator-123', exp: now + 300 };
  const valid = jwt(privateKey, claims);
  const forged = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`;
  assert.throws(() => verifier.verifyToken(forged), (error) => error.category === 'AUTHENTICATION');
  assert.throws(() => verifier.verifyToken(jwt(privateKey, { ...claims, exp: now - 120 })), (error) => error.category === 'AUTHENTICATION');
  assert.throws(() => verifier.verifyToken(jwt(privateKey, { ...claims, aud: 'other-api' })), (error) => error.category === 'AUTHENTICATION');
});

test('runtime JWT adapter fails closed when provider configuration is absent', () => {
  const verifier = createRuntimeBearerJwtAssertionVerifier({});
  assert.throws(() => verifier.verifyRequest({ headers: {} }), (error) => error.category === 'DEPENDENCY' && error.retryable === false);
});
