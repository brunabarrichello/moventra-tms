import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 023 remains materialized after conclusion while Messaging 024 is active', () => {
  for (const path of [
    'db/migrations/0015_outbox.sql',
    'db/validation/0015_outbox_validation.sql',
    'db/runtime/outbox-runtime-access-validation.sql',
    'src/modules/outbox/outbox-contract.js',
    'src/modules/outbox/outbox-repository.js',
    'src/modules/outbox/outbox-service.js',
    'src/modules/outbox/authorized-outbox.js',
    'src/modules/outbox/outbox-observability.js',
    'scripts/db/validate-outbox-concurrency.mjs',
    'docs/implementation/023-outbox.md',
    'docs/implementation/024-mensageria.md',
    'src/modules/messaging/message-envelope.js',
    'src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js',
  ]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }

  assert.equal(existsSync(new URL('../../db/migrations/0016_messaging.sql', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../src/modules/jobs/', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../src/modules/dlq/', import.meta.url)), false);

  const outboxDoc = read('docs/implementation/023-outbox.md');
  assert.match(outboxDoc, /^# 023 — Transactional Outbox/m);
  assert.match(outboxDoc, /## Estado\s+`CONCLUDED`/i);
  assert.match(outboxDoc, /024 — Mensageria = ACTIVE \/ DEFINED/i);
  assert.match(outboxDoc, /não promete exactly-once/i);

  const messagingDoc = read('docs/implementation/024-mensageria.md');
  assert.match(messagingDoc, /^# 024 — Mensageria/m);
  assert.match(messagingDoc, /## Estado\s+`ACTIVE \/ DEFINED`/i);
  assert.match(messagingDoc, /025 — Jobs.*NOT ACTIVE/is);
});

test('outbox persistence is tenant-scoped, append-only in business facts and claim-safe', () => {
  const migration = read('db/migrations/0015_outbox.sql');
  const repository = read('src/modules/outbox/outbox-repository.js');
  const runtimeAccess = read('db/runtime/runtime-access.sql');

  assert.match(migration, /CREATE TABLE outbox\.events/);
  assert.match(migration, /tenant_id UUID NOT NULL/);
  assert.match(migration, /ALTER TABLE outbox\.events ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_isolation_outbox_events/);
  assert.match(migration, /published_at TIMESTAMPTZ NULL/);
  assert.match(migration, /claim_token UUID NULL/);
  assert.doesNotMatch(migration, /UNIQUE\s*\([^)]*dedupe_key/i);

  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /clock_timestamp\(\)/);
  assert.match(repository, /claim_token = NULL/);

  assert.match(runtimeAccess, /GRANT SELECT, INSERT ON outbox\.events/);
  assert.match(runtimeAccess, /GRANT UPDATE \(attempt_count, last_attempt_at, claim_token, claimed_at, published_at\)/);
  assert.match(runtimeAccess, /REVOKE DELETE ON[\s\S]*outbox\.events/);
  assert.match(runtimeAccess, /REVOKE CREATE ON SCHEMA[\s\S]*outbox/);
});

test('outbox append is explicitly bound to the authorized tenant transaction and idempotent callback boundary', () => {
  const authorizedOutbox = read('src/modules/outbox/authorized-outbox.js');
  const authorizedPipeline = read('src/modules/security/authorized-tenant-operation.js');

  assert.match(authorizedOutbox, /operationContext\.query/);
  assert.match(authorizedOutbox, /operationContext\.tenantId/);
  assert.match(authorizedOutbox, /service\.append\(\{ \.\.\.input, tenantId \}\)/);
  assert.match(authorizedPipeline, /execute: \(\) => operation\(operationContext\)/);
});

test('outbox remains provider-neutral after Messaging 024 is introduced', () => {
  const observability = read('src/modules/outbox/outbox-observability.js');
  const source = [
    read('src/modules/outbox/outbox-contract.js'),
    read('src/modules/outbox/outbox-repository.js'),
    read('src/modules/outbox/outbox-service.js'),
    read('src/modules/outbox/authorized-outbox.js'),
  ].join('\n');

  assert.match(observability, /outbox_operations_total/);
  assert.match(observability, /outbox_operation_duration_ms/);
  assert.doesNotMatch(observability, /tenantId|aggregateId|eventId|claimToken|correlationId/);
  assert.doesNotMatch(source, /kafka|rabbitmq|\bsqs\b|\bsns\b|eventbridge|pub\/sub|amqp/i);
  assert.doesNotMatch(source, /setInterval|setTimeout\s*\(/);
});

test('CI database contract continues to execute outbox runtime and concurrency validation', () => {
  const runtimeContract = read('scripts/ci/runtime-access-contract.sh');
  assert.match(runtimeContract, /outbox-runtime-access-validation\.sql/);
  assert.match(runtimeContract, /validate-outbox-concurrency\.mjs/);
});
