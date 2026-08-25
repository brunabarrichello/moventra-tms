import assert from 'node:assert/strict';
import test from 'node:test';

import { observeHttpRequest } from '../../src/infrastructure/observability/http.js';
import { resetObservabilityForTest } from '../../src/infrastructure/observability/telemetry.js';

function fakeResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
  };
}

test('observed HTTP request returns safe request/correlation headers and preserves handler result', async () => {
  const previousDisabled = process.env.OTEL_SDK_DISABLED;
  process.env.OTEL_SDK_DISABLED = 'true';
  resetObservabilityForTest();

  try {
    const response = fakeResponse();
    const result = await observeHttpRequest({
      request: {
        method: 'GET',
        headers: {
          'x-request-id': 'req-observe-020',
          'x-correlation-id': 'corr-observe-020',
        },
      },
      response,
      route: '/health',
      handler: async () => {
        response.statusCode = 200;
        return { ok: true };
      },
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(response.headers.get('x-request-id'), 'req-observe-020');
    assert.equal(response.headers.get('x-correlation-id'), 'corr-observe-020');
    assert.equal(response.statusCode, 200);
  } finally {
    resetObservabilityForTest();
    if (previousDisabled === undefined) {
      delete process.env.OTEL_SDK_DISABLED;
    } else {
      process.env.OTEL_SDK_DISABLED = previousDisabled;
    }
  }
});

test('invalid externally supplied correlation metadata is regenerated instead of reflected', async () => {
  const previousDisabled = process.env.OTEL_SDK_DISABLED;
  process.env.OTEL_SDK_DISABLED = 'true';
  resetObservabilityForTest();

  try {
    const response = fakeResponse();
    await observeHttpRequest({
      request: {
        method: 'GET',
        headers: {
          'x-request-id': 'bad id with spaces',
          'x-correlation-id': 'x'.repeat(200),
        },
      },
      response,
      route: '/health',
      handler: async () => undefined,
    });

    assert.notEqual(response.headers.get('x-request-id'), 'bad id with spaces');
    assert.notEqual(response.headers.get('x-correlation-id'), 'x'.repeat(200));
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.match(response.headers.get('x-correlation-id'), /^[0-9a-f-]{36}$/);
  } finally {
    resetObservabilityForTest();
    if (previousDisabled === undefined) {
      delete process.env.OTEL_SDK_DISABLED;
    } else {
      process.env.OTEL_SDK_DISABLED = previousDisabled;
    }
  }
});
