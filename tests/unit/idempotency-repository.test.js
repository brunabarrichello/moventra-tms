import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresIdempotencyRepository } from '../../src/modules/idempotency/idempotency-repository.js';

const TENANT_ID = '01990220-0000-7000-8000-000000000001';
const RECORD_ID = '01990220-0000-7000-8000-000000000010';

function row(overrides = {}) {
  return {
    id: RECORD_ID,
    tenant_id: TENANT_ID,
    operation_key: 'freight.contract.create',
    key_hash_version: 1,
    fingerprint: 'b'.repeat(64),
    fingerprint_version: 1,
    state: 'PROCESSING',
    response_status: null,
    response_media_type: null,
    response_body: null,
    response_headers: {},
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    completed_at: null,
    expires_at: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

test('claim uses parameterized tenant/operation/hash uniqueness and returns acquired record', async () => {
  const calls = [];
  const repository = new PostgresIdempotencyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rowCount: 1, rows: [row()] };
    },
  });

  const result = await repository.claim({
    tenantId: TENANT_ID,
    operationKey: 'freight.contract.create',
    keyHash: 'a'.repeat(64),
    keyHashVersion: 1,
    fingerprint: 'b'.repeat(64),
    fingerprintVersion: 1,
    expiresAt: '2026-01-02T00:00:00.000Z',
  });

  assert.equal(result.acquired, true);
  assert.equal(result.record.id, RECORD_ID);
  assert.match(calls[0].text, /ON CONFLICT \(tenant_id, operation_key, key_hash\) DO NOTHING/);
  assert.equal(calls[0].values[0], TENANT_ID);
  assert.equal(calls[0].values[2], 'a'.repeat(64));
  assert.equal(calls[0].text.includes('a'.repeat(64)), false);
});

test('claim conflict reloads the committed record inside the same transaction query dependency', async () => {
  const calls = [];
  const repository = new PostgresIdempotencyRepository({
    query: async (text) => {
      calls.push(text);
      if (calls.length === 1) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [row({ state: 'COMPLETED', response_status: 200, response_media_type: 'application/json', response_body: { ok: true }, completed_at: new Date('2026-01-01T00:00:01.000Z') })] };
    },
  });

  const result = await repository.claim({
    tenantId: TENANT_ID,
    operationKey: 'freight.contract.create',
    keyHash: 'a'.repeat(64),
    keyHashVersion: 1,
    fingerprint: 'b'.repeat(64),
    fingerprintVersion: 1,
    expiresAt: '2026-01-02T00:00:00.000Z',
  });

  assert.equal(result.acquired, false);
  assert.equal(result.record.state, 'COMPLETED');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /WHERE tenant_id = \$1/);
});

test('complete updates only an owned PROCESSING record and stores JSON through parameters', async () => {
  const calls = [];
  const repository = new PostgresIdempotencyRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rowCount: 1,
        rows: [row({
          state: 'COMPLETED',
          response_status: 201,
          response_media_type: 'application/json',
          response_body: { ok: true },
          response_headers: { location: '/resource/1' },
          completed_at: new Date('2026-01-01T00:00:01.000Z'),
        })],
      };
    },
  });

  const result = await repository.complete({
    tenantId: TENANT_ID,
    recordId: RECORD_ID,
    responseStatus: 201,
    responseMediaType: 'application/json',
    responseBody: { ok: true },
    responseHeaders: { location: '/resource/1' },
  });

  assert.equal(result.state, 'COMPLETED');
  assert.match(calls[0].text, /AND state = 'PROCESSING'/);
  assert.equal(calls[0].values[0], TENANT_ID);
  assert.equal(calls[0].values[1], RECORD_ID);
  assert.equal(calls[0].values[4], JSON.stringify({ ok: true }));
});
