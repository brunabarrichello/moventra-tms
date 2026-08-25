import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRequestFingerprint,
  canonicalStringify,
  hashIdempotencyKey,
  normalizeIdempotencyKey,
  normalizeOperationKey,
  sanitizeFingerprintInput,
} from '../../src/modules/idempotency/fingerprint.js';

const OPERATION = 'freight.contract.create';

test('canonical JSON is deterministic regardless of object key order', () => {
  const left = canonicalStringify({ b: 2, nested: { z: true, a: 'x' }, a: 1 });
  const right = canonicalStringify({ a: 1, nested: { a: 'x', z: true }, b: 2 });
  assert.equal(left, right);
});

test('same semantic intent produces the same fingerprint', () => {
  const left = buildRequestFingerprint({
    operationKey: OPERATION,
    input: { customerId: 'c-1', amount: 150, items: [{ sku: 'A', qty: 2 }] },
  });
  const right = buildRequestFingerprint({
    operationKey: OPERATION,
    input: { items: [{ qty: 2, sku: 'A' }], amount: 150, customerId: 'c-1' },
  });

  assert.equal(left.value, right.value);
  assert.equal(left.version, right.version);
});

test('semantic changes produce different fingerprints', () => {
  const left = buildRequestFingerprint({
    operationKey: OPERATION,
    input: { customerId: 'c-1', amount: 150 },
  });
  const right = buildRequestFingerprint({
    operationKey: OPERATION,
    input: { customerId: 'c-1', amount: 151 },
  });

  assert.notEqual(left.value, right.value);
});

test('transport credentials and correlation metadata do not affect fingerprint', () => {
  const base = {
    customerId: 'c-1',
    amount: 150,
    requestId: 'req-a',
    correlation_id: 'corr-a',
    traceId: '0123456789abcdef0123456789abcdef',
    authorization: 'Bearer secret-a',
    headers: { cookie: 'session=a' },
  };
  const changedTransport = {
    ...base,
    requestId: 'req-b',
    correlation_id: 'corr-b',
    traceId: 'fedcba9876543210fedcba9876543210',
    authorization: 'Bearer secret-b',
    headers: { cookie: 'session=b' },
  };

  assert.deepEqual(sanitizeFingerprintInput(base), { customerId: 'c-1', amount: 150 });
  assert.equal(
    buildRequestFingerprint({ operationKey: OPERATION, input: base }).value,
    buildRequestFingerprint({ operationKey: OPERATION, input: changedTransport }).value,
  );
});

test('Idempotency-Key is normalized, hashed and never returned in plaintext', () => {
  const raw = ' 01JTESTIDEMPOTENCYKEY000001 ';
  assert.equal(normalizeIdempotencyKey(raw), '01JTESTIDEMPOTENCYKEY000001');
  const hashed = hashIdempotencyKey(raw);
  assert.match(hashed.value, /^[0-9a-f]{64}$/);
  assert.notEqual(hashed.value, raw.trim());
  assert.equal(hashed.version, 1);
});

test('operation key is normalized and constrained to a namespaced application key', () => {
  assert.equal(normalizeOperationKey(' Freight.Contract.Create '), OPERATION);
  assert.throws(
    () => normalizeOperationKey('free form operation'),
    (error) => error.code === 'MVT_IDEMPOTENCY_OPERATION_INVALID',
  );
});

test('fingerprint rejects circular and non JSON-compatible values', () => {
  const circular = {};
  circular.self = circular;
  assert.throws(
    () => buildRequestFingerprint({ operationKey: OPERATION, input: circular }),
    (error) => error.code === 'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
  );
  assert.throws(
    () => buildRequestFingerprint({ operationKey: OPERATION, input: { amount: Number.NaN } }),
    (error) => error.code === 'MVT_IDEMPOTENCY_FINGERPRINT_INVALID',
  );
});
