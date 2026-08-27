import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresDlqRepository } from '../../src/infrastructure/dlq/postgres-dlq-repository.js';

const BEFORE_ID = '01990226-0000-7000-8000-000000000099';

test('DLQ list uses stable (quarantined_at,id) descending keyset pagination', async () => {
  const calls = [];
  const repository = new PostgresDlqRepository({ scope: 'tenant', query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 0, rows: [] }; } });
  await repository.list({ status: 'quarantined', sourceKind: 'message', before: '2026-08-26T22:00:00.000Z', beforeId: BEFORE_ID, limit: 50 });
  assert.match(calls[0].sql, /quarantined_at < \$3::timestamptz/);
  assert.match(calls[0].sql, /quarantined_at = \$3::timestamptz AND id < \$4::uuid/);
  assert.match(calls[0].sql, /ORDER BY quarantined_at DESC, id DESC/);
  assert.deepEqual(calls[0].params, ['quarantined', 'message', '2026-08-26T22:00:00.000Z', BEFORE_ID, 50]);
});

test('DLQ list rejects half-defined keyset cursor', async () => {
  const repository = new PostgresDlqRepository({ scope: 'tenant', query: async () => ({ rowCount: 0, rows: [] }) });
  await assert.rejects(repository.list({ before: '2026-08-26T22:00:00.000Z', beforeId: null }), (error) => error.code === 'MVT_DLQ_CURSOR_INVALID');
});
