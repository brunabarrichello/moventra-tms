import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { AuthenticationError, DependencyError } from '../core/errors/app-error.js';

const ALGORITHMS = Object.freeze({
  RS256: Object.freeze({ digest: 'RSA-SHA256', dsaEncoding: null }),
  ES256: Object.freeze({ digest: 'sha256', dsaEncoding: 'ieee-p1363' }),
  EdDSA: Object.freeze({ digest: null, dsaEncoding: null }),
});
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_BYTES = 16 * 1024;

export class BearerJwtAssertionVerifier {
  constructor({
    providerKey,
    issuer,
    audience,
    publicKeyPem,
    algorithm = 'RS256',
    clock = () => Math.floor(Date.now() / 1000),
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
  } = {}) {
    this.providerKey = normalizeProviderKey(providerKey);
    this.issuer = requireText(issuer, 'JWT issuer');
    this.audience = requireText(audience, 'JWT audience');
    this.algorithm = normalizeAlgorithm(algorithm);
    this.publicKey = normalizePublicKey(publicKeyPem);
    if (typeof clock !== 'function') {
      throw new TypeError('BearerJwtAssertionVerifier clock must be a function');
    }
    if (!Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300) {
      throw new TypeError('JWT clock skew must be an integer between 0 and 300 seconds');
    }
    this.clock = clock;
    this.clockSkewSeconds = clockSkewSeconds;
  }

  verifyRequest(request) {
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

  verifyToken(token) {
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
    if (!verifyJwtSignature({
      algorithm: this.algorithm,
      publicKey: this.publicKey,
      signingInput,
      signature,
    })) {
      throw new AuthenticationError({ message: 'JWT signature is invalid' });
    }

    validateClaims(claims, {
      issuer: this.issuer,
      audience: this.audience,
      now: this.clock(),
      clockSkewSeconds: this.clockSkewSeconds,
    });

    return Object.freeze({
      providerKey: this.providerKey,
      issuer: this.issuer,
      subject: claims.sub.trim(),
    });
  }
}

export function createRuntimeBearerJwtAssertionVerifier(env = process.env) {
  try {
    return new BearerJwtAssertionVerifier({
      providerKey: env.MOVENTRA_AUTH_PROVIDER_KEY,
      issuer: env.MOVENTRA_AUTH_JWT_ISSUER,
      audience: env.MOVENTRA_AUTH_JWT_AUDIENCE,
      publicKeyPem: env.MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM,
      algorithm: env.MOVENTRA_AUTH_JWT_ALGORITHM || 'RS256',
    });
  } catch (cause) {
    return Object.freeze({
      verifyRequest() {
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

function validateClaims(claims, { issuer, audience, now, clockSkewSeconds }) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new AuthenticationError({ message: 'JWT claims are invalid' });
  }
  if (claims.iss !== issuer || typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new AuthenticationError({ message: 'JWT identity claims are invalid' });
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
