import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  normalizeClaimIdentifier,
  normalizeOutboxAppendInput,
} from './outbox-contract.js';
import { recordOutboxOperation } from './outbox-observability.js';

const DEFAULT_CLAIM_LIMIT = 50;
const MAX_CLAIM_LIMIT = 500;
const DEFAULT_CLAIM_TTL_MS = 60_000;
const MIN_CLAIM_TTL_MS = 1_000;
const MAX_CLAIM_TTL_MS = 60 * 60 * 1000;

export class OutboxService {
  constructor({ repository }) {
    if (
      !repository
      || typeof repository.append !== 'function'
      || typeof repository.claimBatch !== 'function'
      || typeof repository.markPublished !== 'function'
    ) {
      throw new TypeError('OutboxService requires an outbox repository');
    }
    this.repository = repository;
  }

  async append(input) {
    const startedAt = performance.now();
    try {
      const event = normalizeOutboxAppendInput(input, input?.tenantId);
      const persisted = await this.repository.append(event);
      observe('append', 'success', startedAt);
      return persisted;
    } catch (error) {
      observe('append', 'failed', startedAt);
      throw error;
    }
  }

  async claimBatch({
    limit = DEFAULT_CLAIM_LIMIT,
    claimTtlMs = DEFAULT_CLAIM_TTL_MS,
    claimToken = randomUUID(),
  } = {}) {
    const startedAt = performance.now();
    const normalizedLimit = normalizeLimit(limit);
    const normalizedClaimTtlMs = normalizeClaimTtl(claimTtlMs);
    const normalizedClaimToken = normalizeClaimIdentifier(claimToken, 'claimToken');

    try {
      const events = await this.repository.claimBatch({
        limit: normalizedLimit,
        claimTtlMs: normalizedClaimTtlMs,
        claimToken: normalizedClaimToken,
      });
      observe('claim', events.length === 0 ? 'empty' : 'success', startedAt);
      return Object.freeze({
        claimToken: normalizedClaimToken,
        events: Object.freeze([...events]),
      });
    } catch (error) {
      observe('claim', 'failed', startedAt);
      throw error;
    }
  }

  async markPublished({ eventId, claimToken }) {
    const startedAt = performance.now();
    const normalizedEventId = normalizeClaimIdentifier(eventId, 'eventId');
    const normalizedClaimToken = normalizeClaimIdentifier(claimToken, 'claimToken');

    try {
      const event = await this.repository.markPublished({
        eventId: normalizedEventId,
        claimToken: normalizedClaimToken,
      });
      if (!event) {
        observe('mark_published', 'conflict', startedAt);
        throw outboxServiceError(
          'MVT_OUTBOX_PUBLISH_CONFLICT',
          'Outbox event is not owned by the supplied active claim',
        );
      }
      observe('mark_published', 'success', startedAt);
      return event;
    } catch (error) {
      if (error?.code !== 'MVT_OUTBOX_PUBLISH_CONFLICT') {
        observe('mark_published', 'failed', startedAt);
      }
      throw error;
    }
  }
}

function normalizeLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLAIM_LIMIT) {
    throw outboxServiceError('MVT_OUTBOX_CLAIM_INVALID', 'Outbox claim limit is invalid');
  }
  return limit;
}

function normalizeClaimTtl(value) {
  const ttl = Number(value);
  if (!Number.isInteger(ttl) || ttl < MIN_CLAIM_TTL_MS || ttl > MAX_CLAIM_TTL_MS) {
    throw outboxServiceError('MVT_OUTBOX_CLAIM_INVALID', 'Outbox claim TTL is invalid');
  }
  return ttl;
}

function observe(operation, outcome, startedAt) {
  recordOutboxOperation({
    operation,
    outcome,
    durationMs: performance.now() - startedAt,
  });
}

function outboxServiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
