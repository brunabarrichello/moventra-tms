import { performance } from 'node:perf_hooks';
import { trace } from '@opentelemetry/api';
import {
  ConflictError,
  InfrastructureError,
  ValidationError,
} from '../../core/errors/app-error.js';
import { ERROR_CODES } from '../../core/errors/error-codes.js';
import { normalizeTenantId } from '../../infrastructure/database/tenant-context.js';
import { createLogger } from '../../infrastructure/observability/logger.js';
import { recordIdempotencyOperation } from '../../infrastructure/observability/metrics.js';
import {
  buildRequestFingerprint,
  hashIdempotencyKey,
  normalizeOperationKey,
} from './fingerprint.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;
const ALLOWED_RESPONSE_HEADERS = new Set(['content-location', 'etag', 'location']);
const JSON_MEDIA_TYPE = /^application\/(?:[a-z0-9.+-]+\+)?json(?:;\s*charset=utf-8)?$/i;
const idempotencyLogger = createLogger('idempotency');

export class IdempotencyService {
  constructor({ repository, ttlMs = DEFAULT_TTL_MS, clock = Date.now } = {}) {
    if (
      !repository
      || typeof repository.claim !== 'function'
      || typeof repository.complete !== 'function'
    ) {
      throw new TypeError('IdempotencyService requires an idempotency repository');
    }
    if (typeof clock !== 'function') {
      throw new TypeError('IdempotencyService clock must be a function');
    }
    if (!Number.isInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new TypeError('IdempotencyService ttlMs is outside the supported range');
    }

    this.repository = repository;
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  async execute({
    tenantId,
    operationKey,
    idempotencyKey,
    fingerprintInput,
    responseStatus = 200,
    responseMediaType = 'application/json',
    responseHeaders = {},
    execute,
  }) {
    if (idempotencyKey === null || idempotencyKey === undefined || idempotencyKey === '') {
      throw new ValidationError({
        code: ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
        message: 'Idempotency-Key is required for this operation',
      });
    }
    if (typeof execute !== 'function') {
      throw new TypeError('IdempotencyService execute callback must be a function');
    }

    const normalizedTenantId = normalizeTenantId(tenantId);
    const normalizedOperationKey = normalizeOperationKey(operationKey);
    const keyHash = hashIdempotencyKey(idempotencyKey);
    const fingerprint = buildRequestFingerprint({
      operationKey: normalizedOperationKey,
      input: fingerprintInput,
    });
    const normalizedResponseContract = normalizeResponseContract({
      responseStatus,
      responseMediaType,
      responseHeaders,
    });
    const startedAt = performance.now();

    try {
      const claim = await this.repository.claim({
        tenantId: normalizedTenantId,
        operationKey: normalizedOperationKey,
        keyHash: keyHash.value,
        keyHashVersion: keyHash.version,
        fingerprint: fingerprint.value,
        fingerprintVersion: fingerprint.version,
        expiresAt: new Date(this.clock() + this.ttlMs).toISOString(),
      });

      if (!claim.acquired) {
        return this.#replayOrReject({
          record: claim.record,
          fingerprint,
          operationKey: normalizedOperationKey,
          startedAt,
        });
      }

      const body = normalizeStoredBody(await execute());
      const completed = await this.repository.complete({
        tenantId: normalizedTenantId,
        recordId: claim.record.id,
        responseStatus: normalizedResponseContract.status,
        responseMediaType: normalizedResponseContract.mediaType,
        responseBody: body,
        responseHeaders: normalizedResponseContract.headers,
      });

      observeIdempotency({
        operationKey: normalizedOperationKey,
        outcome: 'executed',
        durationMs: performance.now() - startedAt,
      });

      return freezeResult('executed', completed);
    } catch (error) {
      const outcome = error?.code === ERROR_CODES.IDEMPOTENCY_REQUEST_MISMATCH
        ? 'mismatch'
        : 'failed';
      observeIdempotency({
        operationKey: normalizedOperationKey,
        outcome,
        durationMs: performance.now() - startedAt,
      });
      throw error;
    }
  }

  #replayOrReject({ record, fingerprint, operationKey, startedAt }) {
    if (
      record.fingerprint !== fingerprint.value
      || record.fingerprintVersion !== fingerprint.version
    ) {
      throw new ConflictError({
        code: ERROR_CODES.IDEMPOTENCY_REQUEST_MISMATCH,
        message: 'Idempotency-Key was already used for a different request intent',
      });
    }

    const expiresAt = Date.parse(record.expiresAt);
    if (
      record.state !== 'COMPLETED'
      || !Number.isFinite(expiresAt)
      || expiresAt <= this.clock()
      || record.responseStatus === null
      || !record.responseMediaType
    ) {
      throw new InfrastructureError({
        code: ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE,
        message: 'Stored idempotency result is not safely replayable',
        retryable: record.state !== 'COMPLETED',
        retryStrategy: record.state !== 'COMPLETED' ? 'backoff' : 'none',
      });
    }

    observeIdempotency({
      operationKey,
      outcome: 'replayed',
      durationMs: performance.now() - startedAt,
    });
    return freezeResult('replayed', record);
  }
}

export function normalizeStoredBody(value) {
  if (value === undefined) {
    throw new InfrastructureError({
      code: ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE,
      message: 'Idempotent operation returned an undefined result',
    });
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (cause) {
    throw new InfrastructureError({
      code: ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE,
      message: 'Idempotent operation result is not JSON serializable',
      cause,
    });
  }

  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BODY_BYTES) {
    throw new InfrastructureError({
      code: ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE,
      message: 'Idempotent operation result exceeds the safe replay size',
    });
  }

  return JSON.parse(serialized);
}

function normalizeResponseContract({ responseStatus, responseMediaType, responseHeaders }) {
  const status = Number(responseStatus);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError('Idempotency responseStatus must be a valid HTTP status');
  }

  if (typeof responseMediaType !== 'string' || !JSON_MEDIA_TYPE.test(responseMediaType.trim())) {
    throw new TypeError('Idempotency responseMediaType must be a JSON media type');
  }

  return Object.freeze({
    status,
    mediaType: responseMediaType.trim().toLowerCase(),
    headers: normalizeResponseHeaders(responseHeaders),
  });
}

function normalizeResponseHeaders(value) {
  if (value === null || value === undefined) {
    return Object.freeze({});
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Idempotency responseHeaders must be an object');
  }

  const output = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim().toLowerCase();
    if (!ALLOWED_RESPONSE_HEADERS.has(name)) {
      continue;
    }
    if (typeof rawValue !== 'string') {
      throw new TypeError(`Idempotency replay header ${name} must be a string`);
    }
    const headerValue = rawValue.trim();
    if (!headerValue || headerValue.length > 1024 || /[\r\n]/.test(headerValue)) {
      throw new TypeError(`Idempotency replay header ${name} is invalid`);
    }
    output[name] = headerValue;
  }
  return Object.freeze(output);
}

function freezeResult(outcome, record) {
  return Object.freeze({
    outcome,
    replayed: outcome === 'replayed',
    response: Object.freeze({
      status: record.responseStatus,
      mediaType: record.responseMediaType,
      body: record.responseBody,
      headers: Object.freeze({ ...record.responseHeaders }),
    }),
  });
}

function observeIdempotency({ operationKey, outcome, durationMs }) {
  try {
    recordIdempotencyOperation({ operationKey, outcome, durationMs });
    const span = trace.getActiveSpan();
    span?.setAttribute('moventra.idempotency.operation', operationKey);
    span?.setAttribute('moventra.idempotency.outcome', outcome);
    idempotencyLogger.info('Idempotency operation completed', {
      event: 'idempotency.operation.completed',
      operationKey,
      outcome,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  } catch {
    // Idempotency correctness must never depend on telemetry.
  }
}
