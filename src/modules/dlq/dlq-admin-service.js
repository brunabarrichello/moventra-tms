import {
  AuthenticationError, AuthorizationError, ConflictError, ConcurrencyError,
  DependencyError, NotFoundError, ValidationError,
} from '../../core/errors/app-error.js';
import { PostgresDlqRepository } from '../../infrastructure/dlq/postgres-dlq-repository.js';
import { PostgresJobReprocessRepository } from '../../infrastructure/jobs/postgres-job-reprocess-repository.js';
import { RabbitMqMessagingAdapter } from '../../infrastructure/messaging/rabbitmq/rabbitmq-adapter.js';
import { resolveMessagingConfig } from '../../infrastructure/messaging/rabbitmq/rabbitmq-config.js';
import { PostgresAuditRepository } from '../audit/audit-repository.js';
import { JobHandlerRegistry } from '../jobs/job-handler-registry.js';
import { PostgresOutboxRepository } from '../outbox/outbox-repository.js';
import { AuthorizedTenantOperationService } from '../security/authorized-tenant-operation.js';
import { DlqJobReprocessor } from './job-reprocessor.js';
import { DlqMessageReprocessor } from './message-reprocessor.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['quarantined', 'reprocess_pending', 'reprocessing', 'resolved', 'discarded', 'exhausted']);
const SOURCE_KINDS = new Set(['message', 'job']);
const MUTATIONS = Object.freeze({
  reprocess: Object.freeze({ permission: 'dlq.reprocess', operationKey: 'dlq.entry.reprocess' }),
  resolve: Object.freeze({ permission: 'dlq.resolve', operationKey: 'dlq.entry.resolve' }),
  discard: Object.freeze({ permission: 'dlq.discard', operationKey: 'dlq.entry.discard' }),
});

export class DlqAdminService {
  constructor({
    security = new AuthorizedTenantOperationService(),
    dlqRepositoryFactory = (query) => new PostgresDlqRepository({ query, scope: 'tenant' }),
    outboxRepositoryFactory = (query) => new PostgresOutboxRepository({ query }),
    jobRepositoryFactory = (query) => new PostgresJobReprocessRepository({ query, scope: 'tenant' }),
    auditRepositoryFactory = (query) => new PostgresAuditRepository({ query }),
    publisherFactory = createRuntimePublisher,
    jobRegistryFactory = () => new JobHandlerRegistry(),
  } = {}) {
    if (!security || typeof security.execute !== 'function') {
      throw new TypeError('DlqAdminService requires AuthorizedTenantOperationService');
    }
    for (const factory of [dlqRepositoryFactory, outboxRepositoryFactory, jobRepositoryFactory,
      auditRepositoryFactory, publisherFactory, jobRegistryFactory]) {
      if (typeof factory !== 'function') {
        throw new TypeError('DlqAdminService factories must be functions');
      }
    }
    Object.assign(this, { security, dlqRepositoryFactory, outboxRepositoryFactory, jobRepositoryFactory,
      auditRepositoryFactory, publisherFactory, jobRegistryFactory });
  }

  list(input) {
    const common = normalizeCommon(input);
    const filters = normalizeFilters(input?.filters);
    return this.#authorized(common, {
      permission: 'dlq.read', action: 'list', entityId: null, metadata: { filters },
    }, async ({ query }) => {
      const entries = await this.dlqRepositoryFactory(query).list(filters);
      return Object.freeze({
        items: Object.freeze(entries.map(toAdminEntry)),
        page: Object.freeze({ limit: filters.limit, nextCursor: entries.length === filters.limit ? encodeCursor(entries.at(-1)) : null }),
      });
    });
  }

  get(input) {
    const common = normalizeCommon(input);
    const id = uuid(input?.id, 'DLQ entry id');
    return this.#authorized(common, { permission: 'dlq.read', action: 'read', entityId: id }, async ({ query }) => {
      const entry = await this.dlqRepositoryFactory(query).findById({ id });
      if (!entry || entry.scope !== 'tenant') {
        throw new NotFoundError({ message: 'DLQ entry was not found in the authorized Tenant' });
      }
      return toAdminEntry(entry);
    });
  }

  reprocess(input) { return this.#mutate('reprocess', input); }
  resolve(input) { return this.#mutate('resolve', input); }
  discard(input) { return this.#mutate('discard', input); }

  #mutate(action, input) {
    const descriptor = MUTATIONS[action];
    const common = normalizeCommon(input);
    const id = uuid(input?.id, 'DLQ entry id');
    const expectedVersion = positiveVersion(input?.expectedVersion);
    const idempotencyKey = idempotencyKeyOf(input?.idempotencyKey);
    return this.#authorized(common, {
      permission: descriptor.permission,
      action,
      entityId: id,
      idempotency: {
        key: idempotencyKey,
        operationKey: descriptor.operationKey,
        fingerprintInput: Object.freeze({ id, expectedVersion, action }),
        responseStatus: 200,
      },
    }, async (context) => {
      const repository = this.dlqRepositoryFactory(context.query);
      const before = await repository.findById({ id });
      if (!before || before.scope !== 'tenant') {
        throw new NotFoundError({ message: 'DLQ entry was not found in the authorized Tenant' });
      }
      if (before.version !== expectedVersion) {
        throw new ConcurrencyError({ message: 'DLQ entry version does not match If-Match' });
      }
      assertState(before, action);

      let mutation;
      try {
        mutation = action === 'reprocess'
          ? await this.#reprocess(context, repository, before, expectedVersion)
          : await terminalDecision(repository, context, before, expectedVersion, action);
      } catch (error) {
        throw mapMutationError(error);
      }

      await this.auditRepositoryFactory(context.query).append({
        tenantId: context.tenantId,
        actorUserId: context.user.id,
        actorMembershipId: context.membership.id,
        category: 'dlq', action: `dlq.entry.${action}`, entityType: 'dlq_entry', entityId: id,
        outcome: 'SUCCESS', requestId: common.requestId, correlationId: common.correlationId,
        beforeData: auditState(before), afterData: auditState(mutation.entry),
        metadata: { permission: descriptor.permission, idempotencyKeyPresent: true, sourceKind: before.sourceKind },
      });
      return Object.freeze({ entry: toAdminEntry(mutation.entry), result: mutation.result });
    });
  }

  async #reprocess(context, repository, entry, expectedVersion) {
    if (entry.sourceKind === 'message') {
      const runtime = this.publisherFactory();
      assertPublisher(runtime);
      try {
        const result = await new DlqMessageReprocessor({
          dlqRepository: repository,
          sourceReader: this.outboxRepositoryFactory(context.query),
          publisher: runtime.publisher,
        }).reprocess({ id: entry.id, expectedVersion });
        return { entry: result.entry, result: Object.freeze({ kind: 'message', messageId: result.messageId, confirmed: result.confirmed === true }) };
      } finally {
        await runtime.close();
      }
    }
    if (entry.sourceKind === 'job') {
      const result = await new DlqJobReprocessor({
        dlqRepository: repository,
        jobRepository: this.jobRepositoryFactory(context.query),
        registry: this.jobRegistryFactory(),
      }).reprocess({ id: entry.id, expectedVersion });
      return { entry: result.entry, result: Object.freeze({ kind: 'job', jobId: result.job.id, rescheduled: result.rescheduled === true }) };
    }
    throw new ConflictError({ message: 'DLQ source kind is not eligible for tenant reprocessing' });
  }

  #authorized(common, descriptor, operation) {
    const request = {
      tenantId: common.tenantId,
      verifiedAssertion: common.verifiedAssertion,
      permission: descriptor.permission,
      scope: { level: 'TENANT' },
      audit: {
        category: 'dlq', action: `dlq.admin.${descriptor.action}`, entityType: 'dlq_entry', entityId: descriptor.entityId,
        requestId: common.requestId, correlationId: common.correlationId,
        metadata: { administrativeApi: true, ...(descriptor.metadata ?? {}) },
      },
      idempotency: descriptor.idempotency ?? null,
    };
    return Promise.resolve().then(() => this.security.execute(request, operation)).catch((error) => { throw mapSecurityError(error); });
  }
}

export function createRuntimePublisher(env = process.env) {
  let config;
  try {
    config = resolveMessagingConfig(env);
  } catch (cause) {
    throw new DependencyError({ message: 'Messaging configuration is unavailable for DLQ reprocessing', cause });
  }
  if (config.provider !== 'rabbitmq') {
    throw new DependencyError({ message: 'RabbitMQ must be enabled for governed DLQ message reprocessing' });
  }
  const publisher = new RabbitMqMessagingAdapter({ config });
  return Object.freeze({ publisher, close: () => publisher.close() });
}

async function terminalDecision(repository, context, entry, expectedVersion, action) {
  const method = action === 'resolve' ? 'resolve' : 'discard';
  const resolutionCode = action === 'resolve' ? 'resolved_by_operator' : 'discarded_by_operator';
  const updated = await repository[method]({
    id: entry.id, expectedVersion, actorId: context.membership.id, resolutionCode,
  });
  if (!updated) {
    throw new ConcurrencyError({ message: `DLQ entry changed before ${action} was persisted` });
  }
  return { entry: updated, result: Object.freeze({ kind: action }) };
}

function normalizeCommon(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError({ message: 'DLQ Admin request must be an object' });
  }
  return Object.freeze({
    tenantId: uuid(input.tenantId, 'Tenant id'), verifiedAssertion: input.verifiedAssertion,
    requestId: auditText(input.requestId, 'Request id'), correlationId: auditText(input.correlationId, 'Correlation id'),
  });
}

function normalizeFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError({ message: 'DLQ list filters must be an object' });
  }
  const status = optionalEnum(value.status, STATUSES, 'status');
  const sourceKind = optionalEnum(value.sourceKind, SOURCE_KINDS, 'source_kind');
  const limit = value.limit === null || value.limit === undefined || value.limit === '' ? 50 : Number(value.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError({ message: 'DLQ list limit must be between 1 and 100' });
  }
  const cursor = decodeCursor(value.cursor);
  return Object.freeze({ status, sourceKind, limit, before: cursor?.quarantinedAt ?? null, beforeId: cursor?.id ?? null });
}

function toAdminEntry(entry) {
  return Object.freeze({
    id: entry.id, sourceKind: entry.sourceKind, sourceId: entry.sourceId, sourceType: entry.sourceType,
    sourceSchemaVersion: entry.sourceSchemaVersion, failureCode: entry.failureCode, failureClass: entry.failureClass,
    snapshot: sanitize(entry.snapshot), metadata: sanitize(entry.metadata), status: entry.status, quarantinedAt: entry.quarantinedAt,
    reprocessCount: entry.reprocessCount, maxReprocessAttempts: entry.maxReprocessAttempts, nextReprocessAt: entry.nextReprocessAt,
    lastReprocessAt: entry.lastReprocessAt, lastFailureCode: entry.lastFailureCode, resolvedAt: entry.resolvedAt,
    resolutionCode: entry.resolutionCode, version: entry.version, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  });
}

function auditState(entry) {
  return { id: entry.id, status: entry.status, version: entry.version, reprocessCount: entry.reprocessCount,
    maxReprocessAttempts: entry.maxReprocessAttempts, nextReprocessAt: entry.nextReprocessAt,
    lastFailureCode: entry.lastFailureCode, resolvedAt: entry.resolvedAt, resolutionCode: entry.resolutionCode };
}

function sanitize(value, depth = 0) {
  if (depth > 6) { return '[TRUNCATED]'; }
  if (Array.isArray(value)) { return Object.freeze(value.slice(0, 100).map((item) => sanitize(item, depth + 1))); }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      output[key] = sensitive(key) ? '[REDACTED]' : sanitize(item, depth + 1);
    }
    return Object.freeze(output);
  }
  if (typeof value === 'string') { return value.length > 4000 ? `${value.slice(0, 4000)}[TRUNCATED]` : value; }
  return ['number', 'boolean'].includes(typeof value) || value === null ? value : String(value ?? '');
}

function sensitive(value) {
  const key = String(value).toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  return ['authorization', 'cookie', 'token', 'secret', 'password', 'privatekey', 'apikey', 'databaseurl', 'rabbitmqurl', 'dsn']
    .some((candidate) => key.includes(candidate));
}

function assertState(entry, action) {
  if (['resolve', 'discard'].includes(action) && entry.status !== 'quarantined') {
    throw new ConflictError({ message: 'Only a quarantined DLQ entry may receive this terminal decision' });
  }
  if (action === 'reprocess' && !['quarantined', 'reprocess_pending'].includes(entry.status)) {
    throw new ConflictError({ message: 'DLQ entry is not eligible for reprocessing in its current state' });
  }
}

function mapSecurityError(error) {
  if (error?.category) { return error; }
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code.startsWith('MVT_AUTH_')) {
    return new AuthenticationError({ message: 'Authenticated identity is not operational for this Tenant', cause: error });
  }
  if (code.startsWith('MVT_RBAC_') || code.startsWith('MVT_SCOPE_')) {
    return new AuthorizationError({ message: 'Administrative permission or organizational scope was denied', cause: error });
  }
  if (code === 'MVT_TENANT_CONTEXT_INVALID' || code.startsWith('MVT_SECURITY_')) {
    return new ValidationError({ message: 'Administrative security context is invalid', cause: error });
  }
  return error;
}

function mapMutationError(error) {
  if (error?.category) { return error; }
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'MVT_DLQ_ENTRY_NOT_FOUND' || code.endsWith('_SOURCE_NOT_FOUND')) {
    return new NotFoundError({ message: 'DLQ source was not found in the authorized Tenant', cause: error });
  }
  if (code.includes('CONFLICT') || code.includes('CLAIM') || code.includes('COMPLETION') || code.includes('LINEAGE')) {
    return new ConcurrencyError({ message: 'DLQ entry changed during the governed decision', cause: error });
  }
  if (code.startsWith('MVT_MESSAGING_')) {
    return new DependencyError({ message: 'Messaging provider could not confirm DLQ reprocessing', retryable: error?.retryable === true,
      retryStrategy: error?.retryable === true ? 'backoff' : 'none', cause: error });
  }
  if (code.startsWith('MVT_DLQ_') || code.startsWith('MVT_JOB_HANDLER_') || code === 'MVT_JOB_SCHEMA_UNSUPPORTED') {
    return new ConflictError({ message: 'DLQ entry is not eligible for the requested decision', cause: error });
  }
  return error;
}

function encodeCursor(entry) {
  return entry?.id && entry?.quarantinedAt
    ? Buffer.from(JSON.stringify({ id: entry.id, quarantinedAt: entry.quarantinedAt }), 'utf8').toString('base64url')
    : null;
}

function decodeCursor(value) {
  if (value === null || value === undefined || value === '') { return null; }
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError({ message: 'DLQ pagination cursor is invalid' });
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const date = new Date(parsed?.quarantinedAt);
    if (!Number.isFinite(date.getTime())) { throw new Error('cursor timestamp'); }
    return Object.freeze({ id: uuid(parsed.id, 'DLQ cursor id'), quarantinedAt: date.toISOString() });
  } catch (cause) {
    if (cause?.category) { throw cause; }
    throw new ValidationError({ message: 'DLQ pagination cursor is invalid', cause });
  }
}

function uuid(value, label) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_RE.test(candidate)) { throw new ValidationError({ message: `${label} must be a canonical UUID` }); }
  return candidate;
}
function positiveVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) { throw new ValidationError({ message: 'If-Match must contain a positive DLQ version' }); }
  return version;
}
function idempotencyKeyOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255) {
    throw new ValidationError({ message: 'Idempotency-Key is required and must not exceed 255 characters' });
  }
  return value.trim();
}
function auditText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) { throw new ValidationError({ message: `${label} is invalid` }); }
  return value.trim();
}
function optionalEnum(value, allowed, field) {
  if (value === null || value === undefined || value === '') { return null; }
  const candidate = String(value).trim().toLowerCase();
  if (!allowed.has(candidate)) { throw new ValidationError({ message: `DLQ filter ${field} is invalid` }); }
  return candidate;
}
function assertPublisher(runtime) {
  if (!runtime || typeof runtime.publisher?.publish !== 'function' || typeof runtime.close !== 'function') {
    throw new TypeError('DLQ publisher factory must return publisher and close()');
  }
}
