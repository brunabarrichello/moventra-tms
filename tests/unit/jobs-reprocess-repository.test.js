import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresJobReprocessRepository } from '../../src/infrastructure/jobs/postgres-job-reprocess-repository.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const SOURCE_JOB_ID = '00000000-0000-7000-8000-000000000016';
const CHILD_JOB_ID = '00000000-0000-7000-8000-000000000116';
const ENTRY_ID = '00000000-0000-7000-8000-000000000026';

function row(overrides = {}) {
  return {
    id: CHILD_JOB_ID,
    tenant_id: TENANT_ID,
    job_type: 'freight.recalculate_eta',
    schema_version: 1,
    payload: { freightId: 'f-1' },
    metadata: { correlationId: 'corr-1' },
    status: 'scheduled',
    priority: 10,
    available_at: new Date('2026-08-26T22:20:00.000Z'),
    attempt_count: 0,
    max_attempts: 3,
    lease_token: null,
    leased_at: null,
    lease_expires_at: null,
    last_heartbeat_at: null,
    last_error_code: null,
    last_error_class: null,
    schedule_key: null,
    recurrence_interval_ms: null,
    reprocessed_from_job_id: SOURCE_JOB_ID,
    reprocessed_from_dlq_entry_id: ENTRY_ID,
    last_completed_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: new Date('2026-08-26T22:20:00.000Z'),
    updated_at: new Date('2026-08-26T22:20:00.000Z'),
    ...overrides,
  };
}

test('tenant replay copia somente do Job terminal autoritativo e grava lineage relacional', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 1, rows: [row()] };
  };
  const repository = new PostgresJobReprocessRepository({ query, scope: 'tenant' });

  const result = await repository.rescheduleFromTerminal({
    sourceJobId: SOURCE_JOB_ID,
    dlqEntryId: ENTRY_ID,
  });

  assert.equal(result.id, CHILD_JOB_ID);
  assert.equal(result.reprocessedFromJobId, SOURCE_JOB_ID);
  assert.equal(result.reprocessedFromDlqEntryId, ENTRY_ID);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO jobs\.jobs/);
  assert.match(calls[0].sql, /FROM jobs\.jobs AS source/);
  assert.match(calls[0].sql, /source\.status = 'failed_terminal'/);
  assert.match(calls[0].sql, /source\.payload/);
  assert.deepEqual(calls[0].params, [SOURCE_JOB_ID, ENTRY_ID]);
});

test('retry ambíguo recupera o mesmo Job filho pela lineage única', async () => {
  const calls = [];
  const responses = [
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [row()] },
  ];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return responses.shift();
  };
  const repository = new PostgresJobReprocessRepository({ query, scope: 'tenant' });

  const result = await repository.rescheduleFromTerminal({
    sourceJobId: SOURCE_JOB_ID,
    dlqEntryId: ENTRY_ID,
  });

  assert.equal(result.id, CHILD_JOB_ID);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /reprocessed_from_dlq_entry_id = \$1/);
  assert.deepEqual(calls[1].params, [ENTRY_ID]);
});

test('conflito sem filho idempotente retorna null para lifecycle aplicar backoff', async () => {
  const query = async () => ({ rowCount: 0, rows: [] });
  const repository = new PostgresJobReprocessRepository({ query, scope: 'tenant' });

  const result = await repository.rescheduleFromTerminal({
    sourceJobId: SOURCE_JOB_ID,
    dlqEntryId: ENTRY_ID,
  });

  assert.equal(result, null);
});

test('findById permanece scope-aware e system replay usa tabela física separada', async () => {
  const calls = [];
  const systemRow = row({
    tenant_id: undefined,
    job_type: 'system.outbox_dispatch',
    cancelled_at: undefined,
  });
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 1, rows: [systemRow] };
  };
  const repository = new PostgresJobReprocessRepository({ query, scope: 'system' });

  const found = await repository.findById({ id: SOURCE_JOB_ID });
  const replay = await repository.rescheduleFromTerminal({
    sourceJobId: SOURCE_JOB_ID,
    dlqEntryId: ENTRY_ID,
  });

  assert.equal(found.scope, 'system');
  assert.equal(found.tenantId, null);
  assert.equal(replay.scope, 'system');
  assert.match(calls[0].sql, /jobs\.system_jobs/);
  assert.match(calls[1].sql, /INSERT INTO jobs\.system_jobs/);
  assert.match(calls[1].sql, /FROM jobs\.system_jobs AS source/);
});
