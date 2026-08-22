import assert from 'node:assert/strict';
import test from 'node:test';
import { getHealthSnapshot } from '../../src/core/health.js';

test('health snapshot exposes stable service identity', () => {
  assert.deepEqual(getHealthSnapshot('commit-123'), {
    status: 'ok',
    product: 'Moventra TMS',
    service: 'moventra-api',
    version: 'commit-123',
  });
});

test('health snapshot is immutable', () => {
  assert.equal(Object.isFrozen(getHealthSnapshot()), true);
});
