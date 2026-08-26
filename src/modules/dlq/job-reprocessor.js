import { randomUUID } from 'node:crypto';

import { computeDlqReprocessDelay } from './dlq-contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CODE_RE = /^[A-Z][A-Z0-9_]{2,159}$/;

const DEFAULT_CLAIM_TTL_MS = 60_000;
const MIN_CLAIM_TTL_MS = 1_000;
const MAX_CLAIM_TTL_MS = 60 * 60 * 1000;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 300_000;

export class DlqJobReprocessor {
  constructor({
    dlqRepository,
    jobRepository,
    registry,
    claimTtlMs = DEFAULT_CLAIM_TTL_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    claimTokenFactory = randomUUID,
    now = () => new Date(),
  } = {}) {
    assertDlqRepository(dlqRepository);
    assertJobRepository(jobRepository);
    if (!registry || typeof registry.resolve !== 'function') {
      throw new TypeError('DlqJobReprocessor requires a JobHandlerRegistry');
    }
    if (typeof claimTokenFactory !== 'function') {
      throw new TypeError('DlqJobReprocessor claimTokenFactory must be a function');
    }
    if (typeof now !== 'function') {
      throw new TypeError('DlqJobReprocessor now must be a function');
    }

    this.dlqRepository = dlqRepository;
    this.jobRepository = jobRepository;
    this.registry = registry;
    this.claimTtlMs = boundedInteger(claimTtlMs, MIN_CLAIM_TTL_MS, MAX_CLAIM_TTL_MS, 'claimTtlMs');
    this.baseDelayMs = boundedInteger(baseDelayMs, 100, 60_000, 'baseDelayMs');
    this.maxDelayMs = boundedInteger(maxDelayMs, this.baseDelayMs, 3_600_000, 'maxDelayMs');
    this.claimTokenFactory = claimTokenFactory;
    this.now = now;
  }

  async reprocess({ id, expectedVersion, claimToken = this.claimTokenFactory() } = {}) {
    const entryId = requireUuid(id, 'id');
    const version = boundedInteger(expectedVersion, 1, Number.MAX_SAFE_INTEGER, 'expectedVersion');
    const token = requireUuid(claimToken, 'claimToken');

    const current = await this.dlqRepository.findById({ id: entryId });
    if (!current) {
      throw reprocessError('MVT_DLQ_ENTRY_NOT_FOUND', 'DLQ entry was not found in the authorized scope', false);
    }
    assertJobEntry(current);

    if (current.status === 'quarantined') {
      const requested = await this.dlqRepository.requestReprocess({
        id: entryId,
        expectedVersion: version,
      });
      if (!requested) {
        throw conflictError();
      }
    } else if (current.status === 'reprocess_pending') {
      if (current.version !== version) {
        throw conflictError();
      }
    } else {
      throw conflictError();
    }

    const claimed = await this.dlqRepository.claimReprocess({
      id: entryId,
      claimToken: token,
      claimTtlMs: this.claimTtlMs,
    });
    if (!claimed) {
      throw reprocessError(
        'MVT_DLQ_REPROCESS_CLAIM_CONFLICT',
        'DLQ reprocess claim could not be acquired',
        true,
      );
    }

    try {
      assertJobEntry(claimed);
      const source = await this.jobRepository.findById({ id: claimed.sourceId });
      if (!source) {
        throw reprocessError(
          'MVT_DLQ_JOB_SOURCE_NOT_FOUND',
          'Authoritative Job source was not found in the authorized scope',
          false,
        );
      }
      assertAuthoritativeJob(claimed, source);

      // Resolve only validates that the current codebase still owns this exact job contract.
      // Reprocessing never invokes the handler inline; the durable Job worker executes the child.
      this.registry.resolve(source);

      const child = await this.jobRepository.rescheduleFromTerminal({
        sourceJobId: source.id,
        dlqEntryId: claimed.id,
      });
      if (!child) {
        throw reprocessError(
          'MVT_DLQ_JOB_RESCHEDULE_CONFLICT',
          'Terminal Job could not be rescheduled without violating the active schedule contract',
          true,
        );
      }
      assertChildLineage(claimed, source, child);

      const completed = await this.dlqRepository.completeReprocess({
        id: entryId,
        claimToken: token,
        resolutionCode: 'job_reprocessed',
      });
      if (!completed) {
        throw reprocessError(
          'MVT_DLQ_REPROCESS_COMPLETION_CONFLICT',
          'DLQ reprocess completion lost claim ownership or lease validity',
          true,
        );
      }

      return Object.freeze({
        entry: completed,
        job: child,
        rescheduled: true,
      });
    } catch (error) {
      await this.#recordFailedAttempt({ entry: claimed, claimToken: token, error });
      throw error;
    }
  }

  async #recordFailedAttempt({ entry, claimToken, error }) {
    const delayMs = computeDlqReprocessDelay({
      attempt: entry.reprocessCount,
      baseMs: this.baseDelayMs,
      maxMs: this.maxDelayMs,
    });
    const nextReprocessAt = addDelay(this.now(), delayMs);

    try {
      await this.dlqRepository.failReprocess({
        id: entry.id,
        claimToken,
        failureCode: normalizeFailureCode(error?.code),
        nextReprocessAt,
      });
    } catch {
      // Best effort only. The original source/reschedule error remains authoritative;
      // lease expiry provides bounded recovery if persistence of the failure also fails.
    }
  }
}

export function createDlqJobReprocessor(options) {
  return new DlqJobReprocessor(options);
}

function assertDlqRepository(repository) {
  const methods = [
    'findById',
    'requestReprocess',
    'claimReprocess',
    'completeReprocess',
    'failReprocess',
  ];
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    throw new TypeError('DlqJobReprocessor requires the governed DLQ repository lifecycle');
  }
}

function assertJobRepository(repository) {
  const methods = ['findById', 'rescheduleFromTerminal'];
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    throw new TypeError('DlqJobReprocessor requires an authoritative Job reprocess repository');
  }
}

function assertJobEntry(entry) {
  if (!['tenant', 'system'].includes(entry?.scope)) {
    throw reprocessError('MVT_DLQ_SCOPE_UNSUPPORTED', 'DLQ Job scope is unsupported', false);
  }
  if (entry.sourceKind !== 'job') {
    throw reprocessError(
      'MVT_DLQ_SOURCE_KIND_UNSUPPORTED',
      'Governed Job reprocessing accepts only source_kind=job',
      false,
    );
  }
}

function assertAuthoritativeJob(entry, source) {
  if (
    source.id !== entry.sourceId
    || source.scope !== entry.scope
    || (entry.scope === 'tenant' && source.tenantId !== entry.tenantId)
    || source.jobType !== entry.sourceType
    || Number(source.schemaVersion) !== Number(entry.sourceSchemaVersion)
  ) {
    throw reprocessError(
      'MVT_DLQ_JOB_SOURCE_MISMATCH',
      'Authoritative Job does not match immutable DLQ source identity',
      false,
    );
  }
  if (source.status !== 'failed_terminal') {
    throw reprocessError(
      'MVT_DLQ_JOB_NOT_TERMINAL',
      'Only an authoritative failed_terminal Job may be rescheduled',
      false,
    );
  }

  const snapshot = entry.snapshot && typeof entry.snapshot === 'object' && !Array.isArray(entry.snapshot)
    ? entry.snapshot
    : {};
  const witnesses = [
    ['jobId', source.id],
    ['jobType', source.jobType],
    ['schemaVersion', Number(source.schemaVersion)],
  ];
  if (entry.scope === 'tenant') {
    witnesses.push(['tenantId', source.tenantId]);
  }
  for (const [field, expected] of witnesses) {
    if (Object.hasOwn(snapshot, field) && normalizedComparable(snapshot[field]) !== normalizedComparable(expected)) {
      throw reprocessError(
        'MVT_DLQ_JOB_SNAPSHOT_MISMATCH',
        'DLQ snapshot witness does not match authoritative Job identity',
        false,
      );
    }
  }
}

function assertChildLineage(entry, source, child) {
  if (
    child.scope !== source.scope
    || (source.scope === 'tenant' && child.tenantId !== source.tenantId)
    || child.jobType !== source.jobType
    || Number(child.schemaVersion) !== Number(source.schemaVersion)
    || child.reprocessedFromJobId !== source.id
    || child.reprocessedFromDlqEntryId !== entry.id
  ) {
    throw reprocessError(
      'MVT_DLQ_JOB_LINEAGE_MISMATCH',
      'Rescheduled Job lineage does not match the governed DLQ decision',
      false,
    );
  }
}

function conflictError() {
  return reprocessError(
    'MVT_DLQ_REPROCESS_CONFLICT',
    'DLQ entry is not eligible for reprocessing at the expected version',
    false,
  );
}

function normalizedComparable(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : String(value);
}

function addDelay(value, delayMs) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('DlqJobReprocessor now() must return a valid date');
  }
  return new Date(date.getTime() + delayMs).toISOString();
}

function normalizeFailureCode(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return FAILURE_CODE_RE.test(candidate) ? candidate : 'MVT_DLQ_JOB_REPROCESS_FAILED';
}

function requireUuid(value, field) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_RE.test(candidate)) {
    throw reprocessError('MVT_DLQ_UUID_INVALID', `${field} must be a canonical UUID`, false);
  }
  return candidate;
}

function boundedInteger(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw reprocessError('MVT_DLQ_FIELD_INVALID', `${field} is outside the allowed range`, false);
  }
  return number;
}

function reprocessError(code, message, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}
