import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDlqTransition,
  buildDlqSnapshot,
  computeDlqReprocessDelay,
  createDlqEntry,
} from '../../src/modules/dlq/dlq-contract.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const SOURCE_ID = '00000000-0000-7000-8000-000000000026';

test('createDlqEntry cria contrato tenant-scoped imutável e normalizado', () => {
  const entry = createDlqEntry({
    scope: 'tenant',
    tenantId: TENANT_ID,
    sourceKind: 'message',
    sourceId: SOURCE_ID,
    sourceType: 'Freight.Status_Changed',
    sourceSchemaVersion: 2,
    failureCode: 'mvt_delivery_failed',
    failureClass: 'Provider_Timeout',
    snapshot: {
      messageId: SOURCE_ID,
      eventType: 'freight.status_changed',
      payload: { freightId: SOURCE_ID },
      ignoredTopLevel: 'must-not-survive',
    },
    metadata: { correlationId: SOURCE_ID },
  });

  assert.equal(entry.scope, 'tenant');
  assert.equal(entry.tenantId, TENANT_ID);
  assert.equal(entry.sourceType, 'freight.status_changed');
  assert.equal(entry.failureCode, 'MVT_DELIVERY_FAILED');
  assert.equal(entry.failureClass, 'provider_timeout');
  assert.equal(entry.snapshot.ignoredTopLevel, undefined);
  assert.equal(entry.snapshot.payload.freightId, SOURCE_ID);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.snapshot), true);
});

test('buildDlqSnapshot aplica allowlist top-level e redação recursiva de segredos', () => {
  const snapshot = buildDlqSnapshot({
    sourceKind: 'message',
    source: {
      messageId: SOURCE_ID,
      eventType: 'shipment.changed',
      payload: {
        customer: 'safe',
        password: 'never-persist',
        nested: {
          Authorization: 'Bearer secret',
          database_url: 'postgres://secret',
          value: 42,
        },
      },
      rawProviderResponse: { token: 'must-be-dropped-with-parent' },
    },
  });

  assert.equal(snapshot.rawProviderResponse, undefined);
  assert.equal(snapshot.payload.customer, 'safe');
  assert.equal(snapshot.payload.password, '[REDACTED]');
  assert.equal(snapshot.payload.nested.Authorization, '[REDACTED]');
  assert.equal(snapshot.payload.nested.database_url, '[REDACTED]');
  assert.equal(snapshot.payload.nested.value, 42);
});

test('createDlqEntry exige namespace system.* para system scope', () => {
  assert.throws(
    () => createDlqEntry({
      scope: 'system',
      sourceKind: 'job',
      sourceId: SOURCE_ID,
      sourceType: 'outbox.dispatch',
      failureCode: 'MVT_JOB_FAILED',
      failureClass: 'terminal',
      snapshot: { jobId: SOURCE_ID, jobType: 'system.outbox_dispatch' },
    }),
    (error) => error.code === 'MVT_DLQ_SOURCE_TYPE_INVALID',
  );
});

test('state machine permite somente transições explícitas', () => {
  assert.equal(assertDlqTransition('quarantined', 'reprocess_pending'), true);
  assert.equal(assertDlqTransition('reprocessing', 'resolved'), true);
  assert.equal(assertDlqTransition('reprocessing', 'exhausted'), true);

  assert.throws(
    () => assertDlqTransition('resolved', 'quarantined'),
    (error) => error.code === 'MVT_DLQ_TRANSITION_INVALID',
  );
  assert.throws(
    () => assertDlqTransition('quarantined', 'reprocessing'),
    (error) => error.code === 'MVT_DLQ_TRANSITION_INVALID',
  );
});

test('reprocess backoff é exponencial e bounded', () => {
  assert.equal(computeDlqReprocessDelay({ attempt: 1, baseMs: 1000, maxMs: 10000 }), 1000);
  assert.equal(computeDlqReprocessDelay({ attempt: 4, baseMs: 1000, maxMs: 10000 }), 8000);
  assert.equal(computeDlqReprocessDelay({ attempt: 10, baseMs: 1000, maxMs: 10000 }), 10000);
});
