import { createLogger } from './infrastructure/observability/logger.js';
import {
  initializeObservability,
  shutdownObservability,
} from './infrastructure/observability/telemetry.js';
import {
  closeDatabasePool,
  queryDatabase,
} from './infrastructure/database/postgres.js';
import { PostgresJobRepository } from './infrastructure/jobs/postgres-job-repository.js';
import { SystemOutboxRepository } from './infrastructure/outbox/system-outbox-repository.js';
import { RabbitMqMessagingAdapter } from './infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from './infrastructure/messaging/rabbitmq/rabbitmq-config.js';
import { JobHandlerRegistry } from './modules/jobs/job-handler-registry.js';
import { JobWorker } from './modules/jobs/job-worker.js';
import {
  createOutboxDispatcherHandler,
  OUTBOX_DISPATCH_JOB_TYPE,
} from './modules/jobs/outbox-dispatcher-job.js';
import { OutboxService } from './modules/outbox/outbox-service.js';

const workerLogger = createLogger('jobs-worker');
const shutdownController = new AbortController();
let shutdownSignal = null;
let messagingAdapter = null;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => requestShutdown(signal));
}

await initializeObservability();

try {
  const principal = await verifyWorkerDatabasePrincipal();
  const messagingConfig = requireRabbitMqWorkerConfig();
  messagingAdapter = new RabbitMqMessagingAdapter({ config: messagingConfig });

  const jobRepository = new PostgresJobRepository({
    query: queryDatabase,
    scope: 'system',
  });
  const outboxRepository = new SystemOutboxRepository({ query: queryDatabase });
  const outboxService = new OutboxService({ repository: outboxRepository });
  const registry = new JobHandlerRegistry().register({
    jobType: OUTBOX_DISPATCH_JOB_TYPE,
    scope: 'system',
    schemaVersions: [1],
    handler: createOutboxDispatcherHandler({
      outboxService,
      publisher: messagingAdapter,
      batchSize: integerSetting('OUTBOX_DISPATCH_BATCH_SIZE', 50, 1, 500),
      claimTtlMs: integerSetting('OUTBOX_DISPATCH_CLAIM_TTL_MS', 60_000, 1_000, 3_600_000),
    }),
  });

  const idlePollMs = integerSetting('JOBS_IDLE_POLL_MS', 1_000, 100, 60_000);
  const idlePollMaxMs = integerSetting('JOBS_IDLE_POLL_MAX_MS', 5_000, idlePollMs, 300_000);
  const worker = new JobWorker({
    repository: jobRepository,
    registry,
    batchSize: integerSetting('JOBS_BATCH_SIZE', 25, 1, 500),
    concurrency: integerSetting('JOBS_CONCURRENCY', 5, 1, 100),
    leaseMs: integerSetting('JOBS_LEASE_MS', 60_000, 1_000, 3_600_000),
    heartbeatMs: integerSetting('JOBS_HEARTBEAT_MS', 20_000, 500, 3_599_999),
    idlePollMs,
    idlePollMaxMs,
    handlerTimeoutMs: integerSetting('JOBS_HANDLER_TIMEOUT_MS', 30_000, 250, 3_600_000),
    retryBaseMs: integerSetting('JOBS_RETRY_BASE_MS', 1_000, 100, 3_600_000),
    retryMaxMs: integerSetting('JOBS_RETRY_MAX_MS', 300_000, 100, 86_400_000),
  });

  workerLogger.info('Dedicated Jobs worker started', {
    event: 'jobs.worker.started',
    databaseRole: principal.roleName,
    handlers: registry.listTypes(),
    idlePollMs,
    idlePollMaxMs,
  });

  await worker.runForever({ signal: shutdownController.signal });

  workerLogger.info('Dedicated Jobs worker stopped accepting work', {
    event: 'jobs.worker.stopped',
    signal: shutdownSignal,
  });
} catch (error) {
  if (!shutdownController.signal.aborted) {
    workerLogger.error('Dedicated Jobs worker failed', {
      event: 'jobs.worker.failed',
      error,
    });
    process.exitCode = 1;
  }
} finally {
  await closeResources();
}

function requestShutdown(signal) {
  if (shutdownController.signal.aborted) {
    return;
  }
  shutdownSignal = signal;
  workerLogger.info('Dedicated Jobs worker shutdown requested', {
    event: 'jobs.worker.shutdown_requested',
    signal,
  });
  const reason = new Error(`Jobs worker shutdown requested by ${signal}`);
  reason.code = 'MVT_JOB_WORKER_SHUTDOWN';
  shutdownController.abort(reason);
}

async function verifyWorkerDatabasePrincipal() {
  const result = await queryDatabase(`
    SELECT
      current_user AS role_name,
      role.rolcanlogin,
      role.rolsuper,
      role.rolcreatedb,
      role.rolcreaterole,
      role.rolreplication,
      role.rolbypassrls,
      has_table_privilege(current_user, 'jobs.system_jobs', 'SELECT') AS can_read_system_jobs,
      has_table_privilege(current_user, 'jobs.system_jobs', 'INSERT') AS can_insert_system_jobs,
      has_table_privilege(current_user, 'jobs.system_jobs', 'DELETE') AS can_delete_system_jobs,
      has_column_privilege(current_user, 'jobs.system_jobs', 'status', 'UPDATE') AS can_update_status,
      has_column_privilege(current_user, 'jobs.system_jobs', 'lease_token', 'UPDATE') AS can_update_lease_token,
      has_column_privilege(current_user, 'jobs.system_jobs', 'lease_expires_at', 'UPDATE') AS can_update_lease_expiry,
      has_column_privilege(current_user, 'jobs.system_jobs', 'last_completed_at', 'UPDATE') AS can_update_last_completed,
      has_table_privilege(current_user, 'jobs.jobs', 'SELECT') AS can_read_tenant_jobs,
      has_table_privilege(current_user, 'outbox.events', 'SELECT') AS can_read_outbox_directly,
      has_function_privilege(
        current_user,
        'outbox.claim_system_batch(integer,bigint,uuid)',
        'EXECUTE'
      ) AS can_claim_outbox,
      has_function_privilege(
        current_user,
        'outbox.mark_system_published(uuid,uuid)',
        'EXECUTE'
      ) AS can_mark_outbox
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `);
  const row = result.rows[0];
  const safe = row
    && row.rolcanlogin === true
    && row.rolsuper === false
    && row.rolcreatedb === false
    && row.rolcreaterole === false
    && row.rolreplication === false
    && row.rolbypassrls === false
    && row.can_read_system_jobs === true
    && row.can_insert_system_jobs === false
    && row.can_delete_system_jobs === false
    && row.can_update_status === true
    && row.can_update_lease_token === true
    && row.can_update_lease_expiry === true
    && row.can_update_last_completed === true
    && row.can_read_tenant_jobs === false
    && row.can_read_outbox_directly === false
    && row.can_claim_outbox === true
    && row.can_mark_outbox === true;

  if (!safe) {
    const error = new Error('Dedicated Jobs worker database principal violates least-privilege contract');
    error.code = 'MVT_JOB_WORKER_DB_PRINCIPAL_INVALID';
    throw error;
  }

  return Object.freeze({ roleName: row.role_name });
}

function requireRabbitMqWorkerConfig() {
  const config = resolveMessagingConfig(process.env);
  if (config.provider !== 'rabbitmq') {
    const error = new Error('Dedicated Jobs worker requires RabbitMQ messaging');
    error.code = 'MVT_JOB_WORKER_MESSAGING_REQUIRED';
    throw error;
  }
  return config;
}

function integerSetting(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

async function closeResources() {
  if (messagingAdapter) {
    await messagingAdapter.close();
    messagingAdapter = null;
  }
  await closeDatabasePool();
  await shutdownObservability();
}
