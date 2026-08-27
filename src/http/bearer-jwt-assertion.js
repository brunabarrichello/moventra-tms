import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { AuthenticationError, DependencyError } from '../core/errors/app-error.js';

const ALGORITHMS = Object.freeze({
  RS256: Object.freeze({ digest: 'RSA-SHA256', dsaEncoding: null }),
  ES256: Object.freeze({ digest: 'sha256', dsaEncoding: 'ieee-p1363' }),
  EdDSA: Object.freeze({ digest: null, dsaEncoding: null }),
});
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_JWKS_TIMEOUT_MS = 3_000;
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_SUBJECT_BYTES = 1024;

export class BearerJwtAssertionVerifier {
  constructor({
    providerKey,
    issuer,
    audience,
    publicKeyPem = null,
    jwksUrl = null,
    algorithm = 'RS256',
    clock = () => Math.floor(Date.now() / 1000),
    clockMs = () => Date.now(),
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
    jwksCacheTtlMs = DEFAULT_JWKS_CACHE_TTL_MS,
    jwksTimeoutMs = DEFAULT_JWKS_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.providerKey = normalizeProviderKey(providerKey);
    this.issuer = requireText(issuer, 'JWT issuer');
    this.audience = requireText(audience, 'JWT audience');
    this.algorithm = normalizeAlgorithm(algorithm);
    this.publicKey = publicKeyPem ? normalizePublicKey(publicKeyPem) : null;
    this.jwksUrl = normalizeOptionalJwksUrl(jwksUrl);
    if (!this.publicKey && !this.jwksUrl) {
      throw new TypeError('JWT verification requires publicKeyPem or jwksUrl');
    }
    if (this.jwksUrl && typeof fetchImpl !== 'function') {
      throw new TypeError('JWT JWKS verification requires fetch support');
    }
    if (typeof clock !== 'function' || typeof clockMs !== 'function') {
      throw new TypeError('BearerJwtAssertionVerifier clocks must be functions');
    }
    if (!Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300) {
      throw new TypeError('JWT clock skew must be an integer between 0 and 300 seconds');
    }
    if (!Number.isInteger(jwksCacheTtlMs) || jwksCacheTtlMs < 1_000 || jwksCacheTtlMs > 3_600_000) {
      throw new TypeError('JWT JWKS cache TTL must be between 1000 and 3600000 milliseconds');
    }
    if (!Number.isInteger(jwksTimeoutMs) || jwksTimeoutMs < 250 || jwksTimeoutMs > 10_000) {
      throw new TypeError('JWT JWKS timeout must be between 250 and 10000 milliseconds');
    }
    this.clock = clock;
    this.clockMs = clockMs;
    this.clockSkewSeconds = clockSkewSeconds;
    this.jwksCacheTtlMs = jwksCacheTtlMs;
    this.jwksTimeoutMs = jwksTimeoutMs;
    this.fetchImpl = fetchImpl;
    this.jwksCache = new Map();
    this.jwksCacheExpiresAt = 0;
  }

  async verifyRequest(request) {
    const authorization = singleHeader(readHeader(request?.headers, 'authorization'));
    if (!authorization) {
      throw new AuthenticationError({ message: 'Authorization bearer token is required' });
    }
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!match) {
      throw new AuthenticationError({ message: 'Authorization bearer token is malformed' });
    }
    return this.verifyToken(match[1]);
  }

  async verifyToken(token) {
    if (typeof token !== 'string' || !token || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
      throw new AuthenticationError({ message: 'Bearer token is invalid' });
    }

    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw new AuthenticationError({ message: 'Bearer token is not a compact JWT' });
    }

    const header = parseJwtJson(parts[0], 'JWT header');
    const claims = parseJwtJson(parts[1], 'JWT claims');
    if (header.alg !== this.algorithm || (header.typ && String(header.typ).toUpperCase() !== 'JWT')) {
      throw new AuthenticationError({ message: 'JWT algorithm or type is not accepted' });
    }

    const signature = decodeBase64Url(parts[2], 'JWT signature');
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii');
    const publicKey = await this.#resolvePublicKey(header);
    if (!verifyJwtSignature({
      algorithm: this.algorithm,
      publicKey,
      signingInput,
      signature,
    })) {
      throw new AuthenticationError({ message: 'JWT signature is invalid' });
    }

    const subject = validateClaims(claims, {
      providerKey: this.providerKey,
      issuer: this.issuer,
      audience: this.audience,
      now: this.clock(),
      clockSkewSeconds: this.clockSkewSeconds,
    });

    return Object.freeze({
      providerKey: this.providerKey,
      issuer: this.issuer,
      subject,
    });
  }

  async #resolvePublicKey(header) {
    if (!this.jwksUrl) {
      return this.publicKey;
    }
    if (typeof header.kid !== 'string' || !header.kid.trim() || header.kid.length > 256) {
      throw new AuthenticationError({ message: 'JWT key id is required for JWKS verification' });
    }
    const kid = header.kid.trim();
    const cached = this.jwksCache.get(kid);
    if (cached && this.clockMs() < this.jwksCacheExpiresAt) {
      return cached;
    }

    await this.#refreshJwks();
    const resolved = this.jwksCache.get(kid);
    if (!resolved) {
      throw new AuthenticationError({ message: 'JWT signing key is not trusted by the configured JWKS' });
    }
    return resolved;
  }

  async #refreshJwks() {
    let response;
    try {
      response = await this.fetchImpl(this.jwksUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.jwksTimeoutMs),
        redirect: 'error',
      });
    } catch (cause) {
      throw new DependencyError({
        message: 'JWT JWKS endpoint is unavailable',
        retryable: true,
        retryStrategy: 'backoff',
        cause,
      });
    }
    if (!response?.ok) {
      throw new DependencyError({
        message: `JWT JWKS endpoint returned HTTP ${Number(response?.status) || 0}`,
        retryable: Number(response?.status) >= 500,
        retryStrategy: Number(response?.status) >= 500 ? 'backoff' : 'none',
      });
    }

    let body;
    try {
      body = await response.json();
    } catch (cause) {
      throw new DependencyError({ message: 'JWT JWKS endpoint returned invalid JSON', retryable: false, cause });
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 20) {
      throw new DependencyError({ message: 'JWT JWKS document has an invalid key set', retryable: false });
    }

    const nextCache = new Map();
    for (const jwk of body.keys) {
      if (!isAcceptedPublicJwk(jwk, this.algorithm)) {
        continue;
      }
      try {
        nextCache.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // Invalid public keys are ignored; fail closed if no usable key remains.
      }
    }
    if (nextCache.size < 1) {
      throw new DependencyError({ message: 'JWT JWKS document contains no usable signing key', retryable: false });
    }
    this.jwksCache = nextCache;
    this.jwksCacheExpiresAt = this.clockMs() + this.jwksCacheTtlMs;
  }
}

export function createRuntimeBearerJwtAssertionVerifier(env = process.env) {
  try {
    return new BearerJwtAssertionVerifier({
      providerKey: env.MOVENTRA_AUTH_PROVIDER_KEY,
      issuer: env.MOVENTRA_AUTH_JWT_ISSUER,
      audience: env.MOVENTRA_AUTH_JWT_AUDIENCE,
      publicKeyPem: env.MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM || null,
      jwksUrl: env.MOVENTRA_AUTH_JWT_JWKS_URL || null,
      algorithm: env.MOVENTRA_AUTH_JWT_ALGORITHM || 'RS256',
    });
  } catch (cause) {
    return Object.freeze({
      async verifyRequest() {
        throw new DependencyError({
          message: 'Administrative API authentication is not configured',
          retryable: false,
          cause,
        });
      },
    });
  }
}

function verifyJwtSignature({ algorithm, publicKey, signingInput, signature }) {
  const contract = ALGORITHMS[algorithm];
  const key = contract.dsaEncoding
    ? { key: publicKey, dsaEncoding: contract.dsaEncoding }
    : publicKey;
  return verifySignature(contract.digest, signingInput, key, signature);
}

function validateClaims(claims, { providerKey, issuer, audience, now, clockSkewSeconds }) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new AuthenticationError({ message: 'JWT claims are invalid' });
  }
  if (claims.iss !== issuer) {
    throw new AuthenticationError({ message: 'JWT issuer is invalid' });
  }
  const subject = resolveSubjectClaim(claims, providerKey);
  if (!subject) {
    throw new AuthenticationError({ message: 'JWT subject is invalid' });
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) {
    throw new AuthenticationError({ message: 'JWT audience is invalid' });
  }
  if (!Number.isInteger(claims.exp) || claims.exp <= now - clockSkewSeconds) {
    throw new AuthenticationError({ message: 'JWT is expired or has no valid expiration' });
  }
  if (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now + clockSkewSeconds)) {
    throw new AuthenticationError({ message: 'JWT is not active yet' });
  }
  if (claims.iat !== undefined && (!Number.isInteger(claims.iat) || claims.iat > now + clockSkewSeconds)) {
    throw new AuthenticationError({ message: 'JWT issued-at claim is invalid' });
  }
  return subject;
}

function resolveSubjectClaim(claims, providerKey) {
  const standardSubject = normalizeSubjectClaim(claims.sub);
  if (standardSubject) {
    return standardSubject;
  }
  if (providerKey === 'neon-auth') {
    return normalizeSubjectClaim(claims.id);
  }
  return null;
}

function normalizeSubjectClaim(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const subject = value.trim();
  if (!subject || Buffer.byteLength(subject, 'utf8') > MAX_SUBJECT_BYTES) {
    return null;
  }
  return subject;
}

function isAcceptedPublicJwk(jwk, algorithm) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
    return false;
  }
  if (typeof jwk.kid !== 'string' || !jwk.kid.trim() || jwk.kid.length > 256) {
    return false;
  }
  if (jwk.use && jwk.use !== 'sig') {
    return false;
  }
  if (jwk.alg && jwk.alg !== algorithm) {
    return false;
  }
  if (Object.hasOwn(jwk, 'd') || Object.hasOwn(jwk, 'p') || Object.hasOwn(jwk, 'q')) {
    return false;
  }
  if (algorithm === 'EdDSA') {
    return jwk.kty === 'OKP' && ['Ed25519', 'Ed448'].includes(jwk.crv) && typeof jwk.x === 'string';
  }
  if (algorithm === 'ES256') {
    return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string';
  }
  return jwk.kty === 'RSA' && typeof jwk.n === 'string' && typeof jwk.e === 'string';
}

function parseJwtJson(segment, label) {
  const decoded = decodeBase64Url(segment, label);
  try {
    const parsed = JSON.parse(decoded.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} is not an object`);
    }
    return parsed;
  } catch (cause) {
    throw new AuthenticationError({ message: `${label} is invalid`, cause });
  }
}

function decodeBase64Url(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuthenticationError({ message: `${label} is malformed` });
  }
  try {
    return Buffer.from(value, 'base64url');
  } catch (cause) {
    throw new AuthenticationError({ message: `${label} is malformed`, cause });
  }
}

function normalizePublicKey(value) {
  const pem = requireText(value, 'JWT public key').replaceAll('\\n', '\n');
  try {
    return createPublicKey(pem);
  } catch (cause) {
    throw new TypeError(`JWT public key is invalid: ${cause instanceof Error ? cause.message : 'unknown error'}`);
  }
}

function normalizeOptionalJwksUrl(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const candidate = requireText(value, 'JWT JWKS URL');
  let url;
  try {
    url = new URL(candidate);
  } catch (cause) {
    throw new TypeError(`JWT JWKS URL is invalid: ${cause instanceof Error ? cause.message : 'unknown error'}`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new TypeError('JWT JWKS URL must be HTTPS without credentials or fragment');
  }
  return url.toString();
}

function normalizeAlgorithm(value) {
  const candidate = requireText(value, 'JWT algorithm');
  if (!Object.hasOwn(ALGORITHMS, candidate)) {
    throw new TypeError('JWT algorithm must be RS256, ES256 or EdDSA');
  }
  return candidate;
}

function normalizeProviderKey(value) {
  const candidate = requireText(value, 'Auth provider key').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(candidate)) {
    throw new TypeError('Auth provider key is invalid');
  }
  return candidate;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  if (typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function singleHeader(value) {
  if (Array.isArray(value)) {
    return value.length === 1 ? String(value[0]).trim() : null;
  }
  return typeof value === 'string' ? value.trim() : null;
}
