import { createHash } from 'node:crypto';

export const IDEMPOTENCY_KEY_HASH_VERSION = 1;
export const IDEMPOTENCY_FINGERPRINT_VERSION = 1;

const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const FINGERPRINT_INPUT_MAX_BYTES = 128 * 1024;
const MAX_CANONICAL_DEPTH = 32;
const OPERATION_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*){1,7}$/;

export function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string') {
    throw idempotencyInputError('MVT_IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be a string');
  }

  const normalized = value.trim();
  if (
    normalized.length < IDEMPOTENCY_KEY_MIN_LENGTH
    || normalized.length > IDEMPOTENCY_KEY_MAX_LENGTH
    || !/^[\x21-\x7E]+$/.test(normalized)
  ) {
    throw idempotencyInputError(
      'MVT_IDEMPOTENCY_KEY_INVALID',
      `Idempotency-Key must contain ${IDEMPOTENCY_KEY_MIN_LENGTH}-${IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters`,
    );
  }
  return normalized;
}

export function normalizeOperationKey(value) {
  if (typeof value !== 'string') {
    throw idempotencyInputError('MVT_IDEMPOTENCY_OPERATION_INVALID', 'operationKey must be a string');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 160 || !OPERATION_KEY_PATTERN.test(normalized)) {
    throw idempotencyInputError(
      'MVT_IDEMPOTENCY_OPERATION_INVALID',
      'operationKey must be a stable namespaced application identifier',
    );
  }
  return normalized;
}

export function hashIdempotencyKey(value) {
  return Object.freeze({
    value: sha256(normalizeIdempotencyKey(value)),
    version: IDEMPOTENCY_KEY_HASH_VERSION,
  });
}

export function buildRequestFingerprint({ operationKey, input }) {
  const normalizedOperation = normalizeOperationKey(operationKey);
  const canonicalPayload = canonicalStringify({
    operation: normalizedOperation,
    payload: input ?? null,
    version: IDEMPOTENCY_FINGERPRINT_VERSION,
  });

  if (Buffer.byteLength(canonicalPayload, 'utf8') > FINGERPRINT_INPUT_MAX_BYTES) {
    throw idempotencyInputError(
      'MVT_IDEMPOTENCY_FINGERPRINT_INPUT_TOO_LARGE',
      'Idempotency fingerprint input exceeds the allowed size',
    );
  }

  return Object.freeze({
    value: sha256(canonicalPayload),
    version: IDEMPOTENCY_FINGERPRINT_VERSION,
  });
}

export function canonicalStringify(value) {
  const stack = new Set();
  return JSON.stringify(canonicalize(value, stack, 0));
}

function canonicalize(value, stack, depth) {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw idempotencyInputError(
      'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
      'Fingerprint input exceeds the maximum nesting depth',
    );
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw idempotencyInputError(
        'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
        'Fingerprint input must contain finite numbers',
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    assertNotCircular(value, stack);
    stack.add(value);
    try {
      return value.map((item) => canonicalize(item, stack, depth + 1));
    } finally {
      stack.delete(value);
    }
  }

  if (isPlainObject(value)) {
    assertNotCircular(value, stack);
    stack.add(value);
    try {
      const output = {};
      for (const key of Object.keys(value).sort()) {
        const item = value[key];
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          throw idempotencyInputError(
            'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
            'Fingerprint input must be JSON-compatible',
          );
        }
        output[key] = canonicalize(item, stack, depth + 1);
      }
      return output;
    } finally {
      stack.delete(value);
    }
  }

  throw idempotencyInputError(
    'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
    'Fingerprint input must contain only JSON-compatible values',
  );
}

function assertNotCircular(value, stack) {
  if (stack.has(value)) {
    throw idempotencyInputError(
      'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
      'Fingerprint input must not contain circular references',
    );
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function idempotencyInputError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}
