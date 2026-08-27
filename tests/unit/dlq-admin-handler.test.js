import assert from 'node:assert/strict';
import test from 'node:test';

import { createDlqAdminHttpHandler } from '../../src/http/dlq-admin-handler.js';

const TENANT_ID = '01990226-0000-7000-8000-000000000001';
const ENTRY_ID = '01990226-0000-7000-8000-000000000004';
function responseStub() {
  const headers = new Map();
  return {
    headersSent: false, statusCode: 200, body: null,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; },
    end(body) { this.body = body ? JSON.parse(body) : null; this.headersSent = true; },
  };
}
function baseHeaders(overrides = {}) { return { authorization: 'Bearer test.jwt.value', 'x-moventra-tenant-id': TENANT_ID, ...overrides }; }
function harness() {
  const calls = [];
  const service = {
    list: async (input) => { calls.push(['list', input]); return { items: [], page: { limit: 50, nextCursor: null } }; },
    get: async (input) => { calls.push(['get', input]); return { id: input.id, version: 3 }; },
    reprocess: async (input) => { calls.push(['reprocess', input]); return { value: { entry: { id: input.id, version: 4 } }, idempotency: { status: 200, outcome: 'executed' } }; },
    resolve: async (input) => { calls.push(['resolve', input]); return { value: { entry: { id: input.id, version: 4 } }, idempotency: { status: 200, outcome: 'replayed' } }; },
    discard: async (input) => { calls.push(['discard', input]); return { value: { entry: { id: input.id, version: 4 } }, idempotency: { status: 200, outcome: 'executed' } }; },
  };
  const assertionVerifier = { verifyRequest: () => ({ providerKey: 'test-idp', issuer: 'https://idp.test', subject: 'operator' }) };
  return { calls, handler: createDlqAdminHttpHandler({ service, assertionVerifier }) };
}

test('GET list parses bounded tenant filters and ignores system selector', async () => {
  const { calls, handler } = harness();
  const response = responseStub();
  await handler({ method: 'GET', url: '/api/v1/dlq/entries?status=quarantined&source_kind=job&limit=25&system=true', headers: baseHeaders() }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0][1].tenantId, TENANT_ID);
  assert.deepEqual(calls[0][1].filters, { status: 'quarantined', sourceKind: 'job', limit: '25', cursor: null });
});

test('GET detail returns strong version ETag', async () => {
  const { handler } = harness();
  const response = responseStub();
  await handler({ method: 'GET', url: `/api/v1/dlq/entries/${ENTRY_ID}`, headers: baseHeaders() }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader('etag'), '"v3"');
});

test('POST requires Idempotency-Key + If-Match and rejects operator body', async () => {
  const { calls, handler } = harness();
  const missing = responseStub();
  await handler({ method: 'POST', url: `/api/v1/dlq/entries/${ENTRY_ID}/resolve`, headers: baseHeaders() }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(calls.length, 0);

  const rejected = responseStub();
  await handler({ method: 'POST', url: `/api/v1/dlq/entries/${ENTRY_ID}/resolve`, headers: baseHeaders({ 'if-match': '"v3"', 'idempotency-key': 'idem-1', 'content-length': '18' }), body: { payload: 'evil' } }, rejected);
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls.length, 0);

  const success = responseStub();
  await handler({ method: 'POST', url: `/api/v1/dlq/entries/${ENTRY_ID}/resolve`, headers: baseHeaders({ 'if-match': '"v3"', 'idempotency-key': 'idem-1' }) }, success);
  assert.equal(success.statusCode, 200);
  assert.equal(success.getHeader('etag'), '"v4"');
  assert.equal(success.getHeader('x-idempotency-outcome'), 'replayed');
  assert.equal(calls[0][1].expectedVersion, 3);
});

test('missing Tenant header returns RFC Problem Details', async () => {
  const { handler } = harness();
  const response = responseStub();
  await handler({ method: 'GET', url: '/api/v1/dlq/entries', headers: { authorization: 'Bearer test.jwt.value' } }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.getHeader('content-type'), 'application/problem+json; charset=utf-8');
  assert.equal(response.body.code, 'VALIDATION.INVALID_INPUT');
});
