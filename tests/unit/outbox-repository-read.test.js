import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresOutboxRepository } from '../../src/modules/outbox/outbox-repository.js';

const EVENT_ID = '00000000-0000-7000-8000-000000000015';
const TENANT_ID = '00000000-0000-7000-8000-000000000001';

test('findById lê somente o evento solicitado e normaliza o registro autoritativo', async () => {
  const calls = [];
  const repository = new PostgresOutboxRepository({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return {
        rowCount: 1,
        rows: [{
          id: EVENT_ID,
          tenant_id: TENANT_ID,
          aggregate_type: 'freight',
          aggregate_id: null,
          event_type: 'freight.status_changed',
          schema_version: 2,
          payload: { status: 'in_transit' },
          metadata: { correlationId: 'corr-026' },
          dedupe_key: 'freight:status:1',
          occurred_at: '2026-08-26T20:00:00.000Z',
          available_at: '2026-08-26T20:00:01.000Z',
          published_at: '2026-08-26T20:00:02.000Z',
          attempt_count: 1,
          last_attempt_at: '2026-08-26T20:00:02.000Z',
          claim_token: null,
          claimed_at: null,
          created_at: '2026-08-26T20:00:00.000Z',
        }],
      };
    },
  });

  const event = await repository.findById({ id: EVENT_ID });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM outbox\.events/);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.deepEqual(calls[0].values, [EVENT_ID]);
  assert.equal(event.id, EVENT_ID);
  assert.equal(event.tenantId, TENANT_ID);
  assert.equal(event.eventType, 'freight.status_changed');
  assert.equal(event.schemaVersion, 2);
  assert.equal(event.payload.status, 'in_transit');
  assert.equal(event.occurredAt, '2026-08-26T20:00:00.000Z');
  assert.equal(Object.isFrozen(event), true);
});

test('findById retorna null quando RLS/escopo não torna o evento visível', async () => {
  const repository = new PostgresOutboxRepository({
    query: async () => ({ rowCount: 0, rows: [] }),
  });

  const event = await repository.findById({ id: EVENT_ID });
  assert.equal(event, null);
});
