import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OutboxService } from '../../src/modules/outbox/outbox-service.js';
import { SystemOutboxRepository } from '../../src/infrastructure/outbox/system-outbox-repository.js';
import { RabbitMqMessagingAdapter } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-config.js';
import { createOutboxDispatcherHandler } from '../../src/modules/jobs/outbox-dispatcher-job.js';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL || undefined });
const config = resolveMessagingConfig(process.env);
const adapter = new RabbitMqMessagingAdapter({ config });
const eventId = randomUUID();
const tenantId = randomUUID();
const aggregateId = randomUUID();
const queue = `moventra.jobs.ci.${randomUUID()}`;
let subscription;

await client.connect();
await client.query('BEGIN');
try {
  await client.query(
    `INSERT INTO organization.tenants (id, code, display_name, status, default_timezone, default_currency)
     VALUES ($1, $2, 'Jobs Dispatcher CI', 'ACTIVE', 'UTC', 'USD')`,
    [tenantId, `jobs-${tenantId.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO outbox.events (
       id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version, payload, metadata
     ) VALUES ($1, $2, 'freight', $3, 'freight.jobs_ci', 1, $4::jsonb, '{}'::jsonb)`,
    [eventId, tenantId, aggregateId, JSON.stringify({ freightId: aggregateId })],
  );

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for dispatched message')), 10000);
    void adapter.subscribe({
      queue,
      routingKeys: ['freight.jobs_ci'],
      handler: async (envelope) => {
        clearTimeout(timer);
        resolve(envelope);
      },
      prefetch: 1,
    }).then((value) => { subscription = value; }).catch(reject);
  });

  while (!subscription) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const repository = new SystemOutboxRepository({ query: (text, values) => client.query(text, values) });
  const outboxService = new OutboxService({ repository });
  const dispatcher = createOutboxDispatcherHandler({ outboxService, publisher: adapter, batchSize: 10, claimTtlMs: 5000 });
  const result = await dispatcher();
  assert.equal(result.claimed, 1);
  assert.equal(result.published, 1);

  const envelope = await received;
  assert.equal(envelope.eventId, eventId);
  assert.equal(envelope.tenantId, tenantId);
  const persisted = await client.query('SELECT published_at FROM outbox.events WHERE id = $1', [eventId]);
  assert.ok(persisted.rows[0].published_at);

  process.stdout.write(JSON.stringify({
    status: 'ok',
    provider: 'rabbitmq',
    outboxDispatch: true,
    publishConfirm: true,
    markPublished: true,
  }) + '\n');
} finally {
  await subscription?.close?.().catch(() => {});
  await adapter.close().catch(() => {});
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
