import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import amqp from 'amqplib';
import { RabbitMqMessagingAdapter } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from '../../src/infrastructure/messaging/rabbitmq/rabbitmq-config.js';

const config = resolveMessagingConfig(process.env);
if (config.provider !== 'rabbitmq') {
  throw new Error('Messaging release smoke requires MESSAGING_PROVIDER=rabbitmq');
}

const environment = normalizeEnvironment(process.env.MOVENTRA_ENV);
const suffix = randomUUID().replaceAll('-', '');
const queue = `moventra.release.smoke.${environment}.${suffix}`;
const eventType = 'platform.messaging_smoke';
const tenantId = randomUUID();
const messageId = randomUUID();
const adapter = new RabbitMqMessagingAdapter({ config });
let subscription;
let cleanupConnection;
let cleanupChannel;
let runtimeSync = 'not-requested';

try {
  const received = deferred();
  subscription = await adapter.subscribe({
    queue,
    routingKeys: [eventType],
    prefetch: 1,
    handler: async (envelope) => received.resolve(envelope),
  });

  const envelope = {
    messageId,
    eventId: messageId,
    tenantId,
    eventType,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId: `release-smoke-${environment}`,
    causationId: null,
    payload: { probe: 'messaging-readiness' },
  };

  const published = await adapter.publish({ envelope, routingKey: eventType });
  if (published.confirmed !== true || published.messageId !== messageId) {
    throw new Error('RabbitMQ release smoke did not receive publisher confirmation');
  }

  const consumed = await waitFor(received.promise, 10_000);
  if (
    consumed.messageId !== messageId
    || consumed.eventId !== messageId
    || consumed.tenantId !== tenantId
    || consumed.eventType !== eventType
  ) {
    throw new Error('RabbitMQ release smoke did not preserve canonical message identity');
  }

  if (hasGovernedVercelContext(process.env)) {
    execFileSync('bash', ['scripts/release/sync-messaging-env-to-vercel.sh'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    runtimeSync = 'success';
  }

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    provider: 'rabbitmq',
    environment,
    tlsRequired: environment === 'staging' || environment === 'production',
    publishConfirm: true,
    manualAck: true,
    consume: true,
    vercelRuntimeSync: runtimeSync,
  })}\n`);
} finally {
  await subscription?.close().catch(() => {});
  await adapter.close().catch(() => {});

  try {
    cleanupConnection = await amqp.connect(config.brokerUrl, {
      clientProperties: { connection_name: `moventra-release-smoke-cleanup-${environment}` },
    });
    cleanupChannel = await cleanupConnection.createChannel();
    await cleanupChannel.deleteQueue(queue);
  } catch {
    // Cleanup is best-effort; broker readiness result must come from the smoke itself.
  } finally {
    await cleanupChannel?.close().catch(() => {});
    await cleanupConnection?.close().catch(() => {});
  }
}

function normalizeEnvironment(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!['staging', 'production'].includes(candidate)) {
    throw new Error('Messaging release smoke requires MOVENTRA_ENV=staging|production');
  }
  return candidate;
}

function hasGovernedVercelContext(env) {
  return [
    env.VERCEL_TOKEN,
    env.VERCEL_ORG_ID,
    env.VERCEL_PROJECT_ID,
    env.VERCEL_PROJECT_NAME,
  ].every((value) => typeof value === 'string' && value.trim().length > 0);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function waitFor(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for RabbitMQ release smoke delivery')), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
