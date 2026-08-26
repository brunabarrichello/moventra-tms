import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemDlqIngestionRepository } from '../../src/infrastructure/dlq/system-dlq-ingestion-repository.js';

const EVENT_ID = '01990260-0000-7000-8000-000000000011';
const TENANT_ID = '01990260-0000-7000-8000-000000000012';

test('system DLQ repository calls only narrow capability and never accepts tenant id', async () => {
  const calls = [];
  const repository = new SystemDlqIngestionRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rowCount: 1,
        rows: [{
          id: '01990260-0000-7000-8000-000000000099',
          tenant_id: TENANT_ID,
          source_id: EVENT_ID,
          source_type: 'freight.created',
          status: 'quarantined',
          version: 1,
        }],
      };
    },
  });

  const result = await repository.quarantineOutboxMessage({
    eventId: EVENT_ID,
    metadata: { broker: { reason: 'rejected' } },
  });

  assert.equal(result.tenantId, TENANT_ID);
  assert.match(calls[0].sql, /dlq\.quarantine_outbox_message/);
  assert.equal(calls[0].params.includes(TENANT_ID), false);
  assert.equal(calls[0].params[0], EVENT_ID);
});

test('system DLQ repository is fail-closed when authoritative source does not exist', async () => {
  const repository = new SystemDlqIngestionRepository({
    query: async () => ({ rowCount: 0, rows: [] }),
  });
  const result = await repository.quarantineOutboxMessage({ eventId: EVENT_ID });
  assert.equal(result, null);
});
