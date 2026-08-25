import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 024 remains materialized provider-neutral while Jobs 025 is active', () => {
  for (const path of [
    'src/modules/messaging/message-envelope.js',
    'src/modules/messaging/messaging-ports.js',
    'src/modules/messaging/messaging-errors.js',
    'src/modules/messaging/messaging-observability.js',
    'src/modules/messaging/outbox-message-mapper.js',
    'src/infrastructure/messaging/rabbitmq/rabbitmq-config.js',
    'src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js',
    'docs/implementation/024-mensageria.md',
    'docs/architecture/024-messaging-provider-decision.md',
    'docs/implementation/025-jobs.md',
    'src/modules/jobs/job-worker.js',
  ]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }

  assert.equal(existsSync(new URL('../../db/migrations/0016_messaging.sql', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../src/modules/dlq/', import.meta.url)), false);

  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies.amqplib, '2.0.1');

  const domainMessaging = [
    read('src/modules/messaging/message-envelope.js'),
    read('src/modules/messaging/messaging-ports.js'),
    read('src/modules/messaging/messaging-errors.js'),
    read('src/modules/messaging/outbox-message-mapper.js'),
  ].join('\n');
  assert.doesNotMatch(domainMessaging, /from ['"]amqplib['"]|rabbitmq|amqp:\/\//i);

  const adapter = read('src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js');
  assert.match(adapter, /from 'amqplib'/);
  assert.match(adapter, /createConfirmChannel/);
  assert.match(adapter, /waitForConfirms/);
  assert.match(adapter, /persistent:\s*true/);
  assert.match(adapter, /noAck:\s*false/);
  assert.match(adapter, /channel\.ack\(/);
  assert.match(adapter, /channel\.nack\(/);
  assert.match(adapter, /prefetch\(/);
});

test('messaging envelope remains tenant-aware, versioned and rejects sensitive payload surfaces', () => {
  const envelope = read('src/modules/messaging/message-envelope.js');
  const mapper = read('src/modules/messaging/outbox-message-mapper.js');

  for (const field of ['messageId', 'eventId', 'tenantId', 'eventType', 'schemaVersion', 'occurredAt', 'payload']) {
    assert.match(envelope, new RegExp(field));
  }
  for (const sensitive of ['authorization', 'cookie', 'password', 'secret', 'token', 'databaseurl', 'idempotencykey']) {
    assert.match(envelope, new RegExp(`'${sensitive}'`));
  }

  assert.match(mapper, /messageId:\s*event\.id/);
  assert.match(mapper, /eventId:\s*event\.id/);
  assert.match(mapper, /tenantId:\s*event\.tenantId/);
  assert.match(mapper, /routingKey:\s*normalizeMessageRoutingKey\(envelope\.eventType\)/);
});

test('messaging observability uses only controlled low-cardinality dimensions', () => {
  const observability = read('src/modules/messaging/messaging-observability.js');
  assert.match(observability, /messaging_operations_total/);
  assert.match(observability, /messaging_operation_duration_ms/);
  assert.match(observability, /messaging_connections_total/);
  assert.match(observability, /messaging_deliveries_total/);
  assert.doesNotMatch(observability, /tenantId|messageId|eventId|correlationId|routingKey|queueName|payload/);
});

test('phase 025 owns recurring execution and administrative DLQ 026 remains inactive', () => {
  const messagingDoc = read('docs/implementation/024-mensageria.md');
  const jobsDoc = read('docs/implementation/025-jobs.md');
  assert.match(messagingDoc, /^# 024 — Mensageria/m);
  assert.match(jobsDoc, /^# 025 — Jobs/m);
  assert.match(jobsDoc, /`ACTIVE \/ DEFINED`/i);
  assert.match(jobsDoc, /Outbox Dispatcher/i);
  assert.match(jobsDoc, /026 — DLQ.*NOT ACTIVE/is);
  assert.match(messagingDoc, /at-least-once/i);
});
