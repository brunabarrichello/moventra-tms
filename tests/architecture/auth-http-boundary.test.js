import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const verifier = fs.readFileSync('src/http/bearer-jwt-assertion.js', 'utf8');
const handler = fs.readFileSync('src/http/dlq-admin-handler.js', 'utf8');
const config = fs.readFileSync('config/auth/neon-auth.json', 'utf8');
const resolver = fs.readFileSync('scripts/release/resolve-auth-provider.mjs', 'utf8');
const sync = fs.readFileSync('scripts/release/sync-auth-env-to-vercel.sh', 'utf8');
const deploy = fs.readFileSync('scripts/release/vercel-deploy-artifact.sh', 'utf8');

const runtimeAndRelease = [verifier, handler, config, resolver, sync, deploy].join('\n');

test('HTTP auth boundary accepts only a cryptographically verified provider tuple', () => {
  assert.match(verifier, /providerKey: this\.providerKey/);
  assert.match(verifier, /issuer: this\.issuer/);
  assert.match(verifier, /subject: claims\.sub\.trim\(\)/);
  assert.match(verifier, /verifyJwtSignature/);
  assert.match(verifier, /validateClaims/);
  assert.match(handler, /await assertionVerifier\.verifyRequest\(request\)/);
});

test('runtime fails closed when JWT trust configuration or JWKS is unavailable', () => {
  assert.match(verifier, /Administrative API authentication is not configured/);
  assert.match(verifier, /JWT JWKS endpoint is unavailable/);
  assert.match(verifier, /JWT signing key is not trusted by the configured JWKS/);
  assert.match(verifier, /redirect: 'error'/);
});

test('private signing material is forbidden from Moventra runtime and release contract', () => {
  assert.doesNotMatch(runtimeAndRelease, /MOVENTRA_AUTH_JWT_PRIVATE_KEY/i);
  assert.doesNotMatch(runtimeAndRelease, /BEGIN PRIVATE KEY/);
  assert.doesNotMatch(config, /privateKey/i);
  assert.match(resolver, /!Object\.hasOwn\(candidate, 'd'\)/);
  assert.match(verifier, /Object\.hasOwn\(jwk, 'd'\)/);
});

test('managed IdP is an adapter configuration, while verification code remains provider-neutral', () => {
  assert.doesNotMatch(verifier, /Neon|Better Auth|Auth0|Clerk|Okta/i);
  assert.doesNotMatch(handler, /Neon|Better Auth|Auth0|Clerk|Okta/i);
  assert.match(config, /"providerKey": "neon-auth"/);
  assert.match(sync, /MOVENTRA_AUTH_PROVIDER_KEY/);
  assert.match(sync, /MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM/);
  assert.match(sync, /MOVENTRA_AUTH_JWT_JWKS_URL/);
  assert.match(deploy, /sync-auth-env-to-vercel\.sh/);
});
