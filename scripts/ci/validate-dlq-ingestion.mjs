import amqp from 'amqplib';
import pg from 'pg';
import { RabbitMqMessagingAdapter } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-config.js';
import { RabbitMqDlqIngestionConsumer } from '../../src/infrastructure/dlq/rabbitmq-dlq-ingestion.js';
import { resolveRabbitMqDlqConfig } from '../../src/infrastructure/dlq/rabbitmq-dlq-config.js';
import { SystemDlqIngestionRepository } from '../../src/infrastructure/dlq/system-dlq-ingestion-repository.js';

const { Client } = pg;
const EVENT_ID = '01990260-0000-7000-8000-000000000071';
const TENANT_ID = '01990260-0000-7000-8000-000000000072';
const EVENT_TYPE = 'freight.dlq_ci';
const sourceQueue = process.env.DLQ_CI_SOURCE_QUEUE || 'moventra.dlq.ci.source';

if (!process.env.DATABASE_URL || !process.env.WORKER_DATABASE_URL) {
  throw new Error('DATABASE_URL and WORKER_DATABASE_URL are required for DLQ integration validation');
}
if (!process.env.MESSAGING_RABBITMQ_URL) {
  throw new Error('MESSAGING_RABBITMQ_URL is required for DLQ integration validation');
}

const admin = new Client({ connectionString: process.env.DATABASE_URL });
const workerDb = new Client({ connectionString: process.env.WORKER_DATABASE_URL });
const rawBroker = await amqp.connect(process.env.MESSAGING_RABBITMQ_URL);
let rawChannel;
let messaging;
let dlqConsumer;

try {
  await admin.connect();
  await workerDb.connect();

  await admin.query(
    `INSERT INTO organization.tenants (
       id, code, display_name, status, default_timezone, default_currency
     ) VALUES ($1, 'dlq-ci-026', 'DLQ CI Tenant', 'ACTIVE', 'UTC', 'USD')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID],
  );
  await admin.query(
    `INSERT INTO outbox.events (
       id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
       payload, metadata, occurred_at, available_at
     ) VALUES (
       $1, $2, 'freight', NULL, $3, 1,
       '{"synthetic":true}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
     )
     ON CONFLICT (id) DO NOTHING`,
    [EVENT_ID, TENANT_ID, EVENT_TYPE],
  );

  await assertDirectWorkerReadsAreDenied(workerDb);

  const messagingConfig = resolveMessagingConfig(process.env);
  const dlqConfig = resolveRabbitMqDlqConfig(process.env);
  messaging = new RabbitMqMessagingAdapter({ config: messagingConfig });
  const repository = new SystemDlqIngestionRepository({ query: workerDb.query.bind(workerDb) });
  const logger = { info() {}, warn() {}, error() {} };
  dlqConsumer = new RabbitMqDlqIngestionConsumer({
    messagingAdapter: messaging,
    repository,
    config: dlqConfig,
    logger,
  });
  await dlqConsumer.start();

  rawChannel = await rawBroker.createChannel();
  await rawChannel.assertExchange(messagingConfig.exchange, 'topic', { durable: true });
  await rawChannel.assertExchange(dlqConfig.deadLetterExchange, 'topic', { durable: true });
  await rawChannel.assertQueue(sourceQueue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': dlqConfig.deadLetterExchange },
  });
  await rawChannel.bindQueue(sourceQueue, messagingConfig.exchange, EVENT_TYPE);
  await rawChannel.prefetch(1);

  const sourceConsumer = await rawChannel.consume(sourceQueue, (message) => {
    if (message) {
      rawChannel.nack(message, false, false);
    }
  }, { noAck: false });

  const envelope = {
    messageId: EVENT_ID,
    eventId: EVENT_ID,
    tenantId: TENANT_ID,
    eventType: EVENT_TYPE,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId: null,
    causationId: null,
    payload: { synthetic: true },
  };

  await messaging.publish({ envelope, routingKey: EVENT_TYPE });
  const first = await waitForDlqEntry(admin, EVENT_ID);
  assert(first.tenant_id === TENANT_ID, 'DLQ tenant must come from authoritative Outbox source');
  assert(first.source_type === EVENT_TYPE, 'DLQ source type must match authoritative Outbox event type');
  assert(first.status === 'quarantined', 'DLQ entry must be quarantined');

  await messaging.publish({ envelope, routingKey: EVENT_TYPE });
  await sleep(500);
  const dedupe = await admin.query(
    `SELECT count(*)::int AS count FROM dlq.entries WHERE source_id = $1`,
    [EVENT_ID],
  );
  assert(dedupe.rows[0].count === 1, 'Repeated dead-letter delivery must dedupe to one logical entry');

  rawChannel.publish(dlqConfig.deadLetterExchange, 'poison.invalid', Buffer.from('{invalid-json'), {
    persistent: true,
    contentType: 'application/json',
  });
  await sleep(500);
  const queueState = await rawChannel.checkQueue(dlqConfig.queue);
  assert(queueState.messageCount === 0, 'Poison DLQ message must not create an infinite broker loop');

  await rawChannel.cancel(sourceConsumer.consumerTag);
  console.log('DLQ PostgreSQL + RabbitMQ ingestion contract passed.');
} finally {
  await dlqConsumer?.close().catch(() => {});
  await messaging?.close().catch(() => {});
  await rawChannel?.close().catch(() => {});
  await rawBroker.close().catch(() => {});
  await workerDb.end().catch(() => {});
  await admin.end().catch(() => {});
}

async function assertDirectWorkerReadsAreDenied(client) {
  for (const table of ['outbox.events', 'dlq.entries', 'dlq.system_entries']) {
    try {
      await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
      throw new Error(`worker unexpectedly read ${table} directly`);
    } catch (error) {
      if (String(error?.code) !== '42501') {
        throw error;
      }
    }
  }
}

async function waitForDlqEntry(client, sourceId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT tenant_id::text, source_type, status FROM dlq.entries WHERE source_id = $1 LIMIT 1`,
      [sourceId],
    );
    if (result.rowCount === 1) {
      return result.rows[0];
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for durable DLQ entry');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
