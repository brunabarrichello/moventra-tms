import { createMessageEnvelope, normalizeMessageRoutingKey } from './message-envelope.js';

export function mapOutboxEventToMessage(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw mapperError('MVT_MESSAGING_OUTBOX_EVENT_INVALID', 'Outbox event is required');
  }

  const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata
    : {};

  const envelope = createMessageEnvelope({
    messageId: event.id,
    eventId: event.id,
    tenantId: event.tenantId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    correlationId: metadata.correlationId ?? null,
    causationId: metadata.causationId ?? null,
    payload: event.payload,
  });

  return Object.freeze({
    envelope,
    routingKey: normalizeMessageRoutingKey(envelope.eventType),
  });
}

function mapperError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
