import { createHash, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const environment = process.argv[2];
if (!['staging', 'production'].includes(environment)) {
  throw new Error('Usage: node scripts/release/resolve-auth-provider.mjs <staging|production>');
}

const configUrl = new URL('../../config/auth/neon-auth.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const selected = config[environment];
if (!selected) {
  throw new Error(`Auth provider configuration is missing for ${environment}`);
}
if (config.algorithm !== 'EdDSA') {
  throw new Error('Managed Neon Auth contract requires EdDSA');
}
for (const [name, value] of Object.entries({
  providerKey: config.providerKey,
  issuer: selected.issuer,
  audience: selected.audience,
  jwksUrl: selected.jwksUrl,
})) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Auth provider ${name} is required`);
  }
}
const allowedSubjectClaims = new Set(['sub', 'id']);
if (
  !Array.isArray(config.subjectClaims)
  || config.subjectClaims.length < 1
  || config.subjectClaims.length > 2
  || config.subjectClaims[0] !== 'sub'
  || new Set(config.subjectClaims).size !== config.subjectClaims.length
  || config.subjectClaims.some((claim) => !allowedSubjectClaims.has(claim))
) {
  throw new Error('Auth provider subjectClaims must be an ordered unique subset of sub,id beginning with sub');
}
if (selected.issuer !== selected.audience) {
  throw new Error('Managed Better Auth issuer and audience must be identical for this provider contract');
}
const jwksUrl = new URL(selected.jwksUrl);
if (jwksUrl.protocol !== 'https:' || jwksUrl.username || jwksUrl.password || jwksUrl.hash) {
  throw new Error('Auth provider JWKS URL must be public HTTPS without credentials or fragment');
}

const response = await fetch(jwksUrl, {
  method: 'GET',
  headers: { accept: 'application/json' },
  redirect: 'error',
  signal: AbortSignal.timeout(5_000),
});
if (!response.ok) {
  throw new Error(`Auth provider JWKS returned HTTP ${response.status}`);
}
const jwks = await response.json();
if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 20) {
  throw new Error('Auth provider JWKS does not contain a bounded key set');
}

const key = jwks.keys.find((candidate) => (
  candidate
  && typeof candidate === 'object'
  && candidate.kty === 'OKP'
  && candidate.crv === 'Ed25519'
  && typeof candidate.x === 'string'
  && typeof candidate.kid === 'string'
  && candidate.kid.length > 0
  && (!candidate.use || candidate.use === 'sig')
  && (!candidate.alg || candidate.alg === 'EdDSA')
  && !Object.hasOwn(candidate, 'd')
));
if (!key) {
  throw new Error('Auth provider JWKS contains no usable Ed25519 signing key');
}

const publicKey = createPublicKey({ key, format: 'jwk' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
const publicKeySha256 = createHash('sha256').update(publicKeyDer).digest('hex');

process.stdout.write(JSON.stringify({
  environment,
  providerKey: config.providerKey,
  issuer: selected.issuer,
  audience: selected.audience,
  algorithm: config.algorithm,
  subjectClaims: config.subjectClaims,
  jwksUrl: selected.jwksUrl,
  kid: key.kid,
  publicKeyPem,
  publicKeySha256,
}));
