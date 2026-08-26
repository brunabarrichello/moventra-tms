import { randomUUID } from 'node:crypto';

import { computeDlqReprocessDelay } from './dlq-contract.js';
import { assertMessagingPublisher } from '../messaging/messaging-ports.js';
import { mapOutboxEventToMessage } from '../messaging/outbox-message-mapper.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CODE_RE = /^[A-Z][A-Z0-9_]{2,159}$/;

const DEFAULT_CLAIM_TTL_MS = 60_000;
const MIN_CLAIM_TTL_MS = 1_000;
const MAX_CLAIM_TTL_MS = 60 * 60 * 1000;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 300_000;

export class DlqMessageReprocessor {
  constructor({
    dlqRepository,
    sourceReader,
    publisher,
    claimTtlMs = DEFAULT_CLAIM_TTL_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    claimTokenFactory = randomUUID,
    now = () => new Date(),
  } = {}) {
    assertDlqRepository(dlqRepository);
    if (!sourceReader || typeof sourceReader.findById !== 'function') {
      throw new TypeError('DlqMessageReprocessor requires an authoritative sourceReader.findById()');
    }
    if (typeof claimTokenFactory !== 'function') {
      throw new TypeError('DlqMessageReprocessor claimTokenFactory must be a function');
    }
    if (typeof now !== 'function') {
      throw new TypeError('DlqMessageReprocessor now must be a function');
    }

    this.dlqRepository = dlqRepository;
    this.sourceReader = sourceReader;
    this.publisher = assertMessagingPublisher(publisher);
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
      throw reprocessError('MVT_DLQ_ENTRY_NOT_FOUND', 'DLQ entry was not found in the authorized tenant scope', false);
    }
    assertMessageEntry(current);

    const requested = await this.dlqRepository.requestReprocess({
      id: entryId,
      expectedVersion: version,
    });
    if (!requested) {
      throw reprocessError(
        'MVT_DLQ_REPROCESS_CONFLICT',
        'DLQ entry is not eligible for reprocessing at the expected version',
        false,
      );
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
      assertMessageEntry(claimed);
      const source = await this.sourceReader.findById({ id: claimed.sourceId });
      if (!source) {
        throw reprocessError(
          'MVT_DLQ_SOURCE_NOT_FOUND',
          'Authoritative Outbox source was not found in the authorized tenant scope',
          false,
        );
      }
      assertAuthoritativeSource(claimed, source);

      const message = mapOutboxEventToMessage(source);
      const publishResult = await this.publisher.publish(message);
      if (publishResult?.confirmed !== true || publishResult.messageId !== claimed.sourceId) {
        throw reprocessError(
          'MVT_DLQ_PUBLISH_NOT_CONFIRMED',
          'Reprocessed message was not confirmed by the messaging provider',
          true,
        );
      }

      const completed = await this.dlqRepository.completeReprocess({
        id: entryId,
        claimToken: token,
        resolutionCode: 'message_reprocessed',
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
        messageId: publishResult.messageId,
        confirmed: true,
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
      // Best effort only. Losing the claim or the database while recording the failure
      // must never hide the original publish/source error. Lease recovery remains bounded.
    }
  }
}

export function createDlqMessageReprocessor(options) {
  return new DlqMessageReprocessor(options);
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
    throw new TypeError('DlqMessageReprocessor requires the governed DLQ repository lifecycle');
  }
}

function assertMessageEntry(entry) {
  if (entry?.scope !== 'tenant') {
    throw reprocessError(
      'MVT_DLQ_SCOPE_UNSUPPORTED',
      'Governed message reprocessing is restricted to tenant-scoped DLQ entries',
      false,
    );
  }
  if (entry.sourceKind !== 'message') {
    throw reprocessError(
      'MVT_DLQ_SOURCE_KIND_UNSUPPORTED',
      'Governed message reprocessing accepts only source_kind=message',
      false,
    );
  }
}

function assertAuthoritativeSource(entry, source) {
  if (
    source.id !== entry.sourceId
    || source.tenantId !== entry.tenantId
    || source.eventType !== entry.sourceType
    || Number(source.schemaVersion) !== Number(entry.sourceSchemaVersion)
  ) {
    throw reprocessError(
      'MVT_DLQ_SOURCE_MISMATCH',
      'Authoritative Outbox source does not match immutable DLQ source identity',
      false,
    );
  }

  const snapshot = entry.snapshot && typeof entry.snapshot === 'object' && !Array.isArray(entry.snapshot)
    ? entry.snapshot
    : {};
  const witnesses = [
    ['eventId', source.id],
    ['messageId', source.id],
    ['tenantId', source.tenantId],
    ['eventType', source.eventType],
    ['schemaVersion', Number(source.schemaVersion)],
  ];
  for (const [field, expected] of witnesses) {
    if (Object.hasOwn(snapshot, field) && normalizedComparable(snapshot[field]) !== normalizedComparable(expected)) {
      throw reprocessError(
        'MVT_DLQ_SNAPSHOT_MISMATCH',
        'DLQ snapshot witness does not match authoritative Outbox source identity',
        false,
      );
    }
  }
}

function normalizedComparable(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : String(value);
}

function addDelay(value, delayMs) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('DlqMessageReprocessor now() must return a valid date');
  }
  return new Date(date.getTime() + delayMs).toISOString();
}

function normalizeFailureCode(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return FAILURE_CODE_RE.test(candidate) ? candidate : 'MVT_DLQ_REPROCESS_FAILED';
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
