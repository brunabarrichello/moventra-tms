import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresDlqRepository } from '../../src/infrastructure/dlq/postgres-dlq-repository.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ENTRY_ID = '00000000-0000-7000-8000-000000000017';
const SOURCE_ID = '00000000-0000-7000-8000-000000000026';
const CLAIM_TOKEN = '00000000-0000-7000-8000-000000000027';

function row(overrides = {}) {
  return {
    id: ENTRY_ID,
    tenant_id: TENANT_ID,
    source_kind: 'message',
    source_id: SOURCE_ID,
    source_type: 'freight.status_changed',
    source_schema_version: 1,
    failure_code: 'MVT_MESSAGE_FAILED',
    failure_class: 'terminal',
    snapshot: { messageId: SOURCE_ID },
    metadata: {},
    status: 'quarantined',
    quarantined_at: '2026-08-26T05:00:00.000Z',
    reprocess_count: 0,
    max_reprocess_attempts: 5,
    next_reprocess_at: null,
    reprocess_claim_token: null,
    reprocess_claimed_at: null,
    reprocess_claim_expires_at: null,
    last_reprocess_at: null,
    last_failure_code: null,
    resolved_at: null,
    resolved_by_membership_id: null,
    resolved_by_user_id: null,
    resolution_code: null,
    version: 1,
    created_at: '2026-08-26T05:00:00.000Z',
    updated_at: '2026-08-26T05:00:00.000Z',
    ...overrides,
  };
}

function tenantEntry() {
  return Object.freeze({
    scope: 'tenant',
    tenantId: TENANT_ID,
    sourceKind: 'message',
    sourceId: SOURCE_ID,
    sourceType: 'freight.status_changed',
    sourceSchemaVersion: 1,
    failureCode: 'MVT_MESSAGE_FAILED',
    failureClass: 'terminal',
    snapshot: Object.freeze({ messageId: SOURCE_ID }),
    metadata: Object.freeze({}),
    maxReprocessAttempts: 5,
  });
}

test('quarantine tenant usa dedupe lógico e retorna registro persistido', async () => {
  const calls = [];
  const repository = new PostgresDlqRepository({
    scope: 'tenant',
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [row()] };
    },
  });

  const saved = await repository.quarantine(tenantEntry());

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, source_kind, source_id\) DO NOTHING/);
  assert.deepEqual(calls[0].params.slice(0, 3), [TENANT_ID, 'message', SOURCE_ID]);
  assert.equal(saved.id, ENTRY_ID);
  assert.equal(saved.scope, 'tenant');
  assert.equal(saved.tenantId, TENANT_ID);
});

test('quarantine repetido resolve para o registro existente sem criar duplicata lógica', async () => {
  let call = 0;
  const repository = new PostgresDlqRepository({
    scope: 'tenant',
    query: async (sql) => {
      call += 1;
      if (call === 1) {
        assert.match(sql, /INSERT INTO dlq\.entries/);
        return { rowCount: 0, rows: [] };
      }
      assert.match(sql, /SELECT \* FROM dlq\.entries/);
      return { rowCount: 1, rows: [row()] };
    },
  });

  const saved = await repository.quarantine(tenantEntry());
  assert.equal(call, 2);
  assert.equal(saved.id, ENTRY_ID);
});

test('requestReprocess exige versão e status quarantined no UPDATE', async () => {
  const calls = [];
  const repository = new PostgresDlqRepository({
    scope: 'tenant',
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rowCount: 1,
        rows: [row({ status: 'reprocess_pending', version: 2, next_reprocess_at: '2026-08-26T05:01:00.000Z' })],
      };
    },
  });

  const updated = await repository.requestReprocess({
    id: ENTRY_ID,
    expectedVersion: 1,
    nextReprocessAt: '2026-08-26T05:01:00.000Z',
  });

  assert.match(calls[0].sql, /version = \$2/);
  assert.match(calls[0].sql, /status = 'quarantined'/);
  assert.match(calls[0].sql, /reprocess_count < max_reprocess_attempts/);
  assert.equal(updated.status, 'reprocess_pending');
  assert.equal(updated.version, 2);
});

test('claimReprocess usa token, lease e recupera somente claim expirado ou pendente elegível', async () => {
  const calls = [];
  const repository = new PostgresDlqRepository({
    scope: 'tenant',
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rowCount: 1,
        rows: [row({
          status: 'reprocessing',
          reprocess_count: 1,
          reprocess_claim_token: CLAIM_TOKEN,
          reprocess_claimed_at: '2026-08-26T05:02:00.000Z',
          reprocess_claim_expires_at: '2026-08-26T05:03:00.000Z',
          last_reprocess_at: '2026-08-26T05:02:00.000Z',
          version: 3,
        })],
      };
    },
  });

  const claimed = await repository.claimReprocess({
    id: ENTRY_ID,
    claimToken: CLAIM_TOKEN,
    claimTtlMs: 60000,
  });

  assert.match(calls[0].sql, /reprocess_count = reprocess_count \+ 1/);
  assert.match(calls[0].sql, /reprocess_claim_expires_at <= clock_timestamp\(\)/);
  assert.deepEqual(calls[0].params, [ENTRY_ID, CLAIM_TOKEN, 60000]);
  assert.equal(claimed.status, 'reprocessing');
  assert.equal(claimed.reprocessClaimToken, CLAIM_TOKEN);
});

test('failReprocess torna exhausted quando tentativas foram consumidas', async () => {
  const repository = new PostgresDlqRepository({
    scope: 'tenant',
    query: async (sql) => {
      assert.match(sql, /WHEN reprocess_count >= max_reprocess_attempts THEN 'exhausted'/);
      return {
        rowCount: 1,
        rows: [row({
          status: 'exhausted',
          reprocess_count: 5,
          last_failure_code: 'MVT_REPROCESS_FAILED',
          version: 7,
        })],
      };
    },
  });

  const failed = await repository.failReprocess({
    id: ENTRY_ID,
    claimToken: CLAIM_TOKEN,
    failureCode: 'MVT_REPROCESS_FAILED',
  });
  assert.equal(failed.status, 'exhausted');
  assert.equal(failed.lastFailureCode, 'MVT_REPROCESS_FAILED');
});

test('repository recusa entry de scope incompatível', async () => {
  const repository = new PostgresDlqRepository({
    scope: 'system',
    query: async () => ({ rowCount: 0, rows: [] }),
  });

  await assert.rejects(
    repository.quarantine(tenantEntry()),
    (error) => error.code === 'MVT_DLQ_SCOPE_REPOSITORY_MISMATCH',
  );
});
