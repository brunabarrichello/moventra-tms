import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../../config/auth/neon-auth.json', import.meta.url), 'utf8'));

for (const environment of ['staging', 'production']) {
  test(`managed ${environment} IdP exposes a bounded public Ed25519 JWKS compatible with Moventra`, { timeout: 10_000 }, async () => {
    assert.equal(config.providerKey, 'neon-auth');
    assert.equal(config.algorithm, 'EdDSA');
    assert.equal(config[environment].issuer, config[environment].audience);

    const issuerUrl = new URL(config[environment].issuer);
    assert.equal(issuerUrl.protocol, 'https:');
    assert.equal(issuerUrl.username, '');
    assert.equal(issuerUrl.password, '');
    assert.equal(issuerUrl.pathname, '/');
    assert.equal(issuerUrl.search, '');
    assert.equal(issuerUrl.hash, '');
    assert.equal(config[environment].issuer, issuerUrl.origin);

    const baseUrl = new URL(config[environment].baseUrl);
    assert.equal(baseUrl.protocol, 'https:');
    assert.equal(baseUrl.username, '');
    assert.equal(baseUrl.password, '');
    assert.equal(baseUrl.origin, issuerUrl.origin);
    assert.notEqual(baseUrl.pathname, '/');
    assert.equal(baseUrl.search, '');
    assert.equal(baseUrl.hash, '');
    assert.equal(baseUrl.toString().replace(/\/$/, ''), config[environment].baseUrl);

    const url = new URL(config[environment].jwksUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.hash, '');
    assert.equal(url.origin, issuerUrl.origin);
    assert.equal(config[environment].jwksUrl, `${config[environment].baseUrl}/.well-known/jwks.json`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.ok, true, `JWKS returned HTTP ${response.status}`);

    const jwks = await response.json();
    assert.equal(Array.isArray(jwks.keys), true);
    assert.ok(jwks.keys.length >= 1 && jwks.keys.length <= 20);

    const accepted = jwks.keys.filter((key) => (
      key
      && typeof key === 'object'
      && key.kty === 'OKP'
      && key.crv === 'Ed25519'
      && typeof key.x === 'string'
      && typeof key.kid === 'string'
      && key.kid.length > 0
      && (!key.alg || key.alg === 'EdDSA')
      && (!key.use || key.use === 'sig')
    ));
    assert.ok(accepted.length >= 1, 'JWKS must expose at least one Ed25519 signing public key');

    for (const key of accepted) {
      for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
        assert.equal(Object.hasOwn(key, privateField), false, `JWKS must not expose ${privateField}`);
      }
      const publicKey = createPublicKey({ key, format: 'jwk' });
      const pem = publicKey.export({ type: 'spki', format: 'pem' });
      const fingerprint = createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex');
      assert.match(pem, /^-----BEGIN PUBLIC KEY-----/);
      assert.match(fingerprint, /^[0-9a-f]{64}$/);
      process.stdout.write(`MOVENTRA_AUTH_PUBLIC_EVIDENCE=${JSON.stringify({
        environment,
        kid: key.kid,
        publicKeyPem: pem,
        publicKeySha256: fingerprint,
      })}\n`);
    }
  });
}
