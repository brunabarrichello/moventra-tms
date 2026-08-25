import { assertMessagingPublisher } from '../messaging/messaging-ports.js';
import { mapOutboxEventToMessage } from '../messaging/outbox-message-mapper.js';

export const OUTBOX_DISPATCH_JOB_TYPE = 'system.outbox_dispatch';

export function createOutboxDispatcherHandler({
  outboxService,
  publisher,
  batchSize = 50,
  claimTtlMs = 60000,
} = {}) {
  if (!outboxService || typeof outboxService.claimBatch !== 'function' || typeof outboxService.markPublished !== 'function') {
    throw new TypeError('Outbox dispatcher requires an OutboxService');
  }
  const messagingPublisher = assertMessagingPublisher(publisher);
  const normalizedBatchSize = boundedInteger(batchSize, 1, 500, 'batchSize');
  const normalizedClaimTtlMs = boundedInteger(claimTtlMs, 1000, 3600000, 'claimTtlMs');

  return async function outboxDispatcher() {
    const claim = await outboxService.claimBatch({
      limit: normalizedBatchSize,
      claimTtlMs: normalizedClaimTtlMs,
    });
    if (claim.events.length === 0) {
      return Object.freeze({ claimed: 0, published: 0 });
    }

    let published = 0;
    let firstFailure = null;
    for (const event of claim.events) {
      try {
        const message = mapOutboxEventToMessage(event);
        const result = await messagingPublisher.publish(message);
        if (result?.confirmed !== true || result.messageId !== event.id) {
          throw retryableError('MVT_OUTBOX_PUBLISH_NOT_CONFIRMED', 'Outbox message was not confirmed by broker');
        }
        await outboxService.markPublished({ eventId: event.id, claimToken: claim.claimToken });
        published += 1;
      } catch (error) {
        firstFailure ??= error;
      }
    }

    if (firstFailure) {
      firstFailure.retryable = firstFailure.retryable !== false;
      throw firstFailure;
    }
    return Object.freeze({ claimed: claim.events.length, published });
  };
}

function retryableError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

function boundedInteger(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}
