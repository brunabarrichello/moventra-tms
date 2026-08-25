import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRequestContext,
  getRequestContext,
  normalizeExternalIdentifier,
  runWithRequestContext,
} from '../../src/infrastructure/observability/request-context.js';

test('request context accepts bounded safe external IDs and regenerates invalid values', () => {
  assert.equal(normalizeExternalIdentifier('req-020.alpha:1'), 'req-020.alpha:1');
  assert.equal(normalizeExternalIdentifier('contains spaces'), null);
  assert.equal(normalizeExternalIdentifier('x'.repeat(129)), null);

  const context = createRequestContext({
    'x-request-id': 'contains spaces',
    'x-correlation-id': 'corr-020',
  });

  assert.match(context.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(context.correlationId, 'corr-020');
});

test('request context defaults correlationId to accepted requestId', () => {
  const context = createRequestContext({ 'x-request-id': 'req-020' });
  assert.equal(context.requestId, 'req-020');
  assert.equal(context.correlationId, 'req-020');
});

test('AsyncLocalStorage keeps concurrent request contexts isolated', async () => {
  const barrier = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = runWithRequestContext(
    { requestId: 'req-a', correlationId: 'corr-a' },
    async () => {
      barrier.push('a');
      await gate;
      return getRequestContext();
    },
  );

  const second = runWithRequestContext(
    { requestId: 'req-b', correlationId: 'corr-b' },
    async () => {
      barrier.push('b');
      await gate;
      return getRequestContext();
    },
  );

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.deepEqual(barrier.sort(), ['a', 'b']);
  release();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.requestId, 'req-a');
  assert.equal(a.correlationId, 'corr-a');
  assert.equal(b.requestId, 'req-b');
  assert.equal(b.correlationId, 'corr-b');
  assert.equal(getRequestContext(), null);
});
