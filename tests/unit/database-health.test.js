import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseHealthSnapshot } from '../../src/core/database-health.js';

test('database health snapshot exposes only sanitized readiness metadata', () => {
  const snapshot = getDatabaseHealthSnapshot(
    {
      ok: true,
      databaseName: 'should-not-leak',
      serverVersionNum: 180006,
      host: 'should-not-leak',
      user: 'should-not-leak',
    },
    'abc123',
  );

  assert.deepEqual(snapshot, {
    status: 'ready',
    service: 'database',
    version: 'abc123',
  });
  assert.equal(Object.hasOwn(snapshot, 'databaseName'), false);
  assert.equal(Object.hasOwn(snapshot, 'serverVersionNum'), false);
  assert.equal(Object.hasOwn(snapshot, 'host'), false);
  assert.equal(Object.hasOwn(snapshot, 'user'), false);
});

test('database health snapshot fails closed when readiness is not explicitly true', () => {
  assert.deepEqual(getDatabaseHealthSnapshot({ ok: false }, 'rev-1'), {
    status: 'unavailable',
    service: 'database',
    version: 'rev-1',
  });

  assert.deepEqual(getDatabaseHealthSnapshot(undefined, 'rev-2'), {
    status: 'unavailable',
    service: 'database',
    version: 'rev-2',
  });
});
