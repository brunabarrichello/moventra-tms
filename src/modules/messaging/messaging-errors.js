const DEFINITIONS = Object.freeze({
  connection_failure: Object.freeze({ code: 'MVT_MESSAGING_CONNECTION_FAILURE', retryable: true }),
  channel_closed: Object.freeze({ code: 'MVT_MESSAGING_CHANNEL_CLOSED', retryable: true }),
  publish_confirm_timeout: Object.freeze({ code: 'MVT_MESSAGING_PUBLISH_CONFIRM_TIMEOUT', retryable: true }),
  broker_nack: Object.freeze({ code: 'MVT_MESSAGING_BROKER_NACK', retryable: true }),
  invalid_envelope: Object.freeze({ code: 'MVT_MESSAGING_INVALID_ENVELOPE', retryable: false }),
  unsupported_schema: Object.freeze({ code: 'MVT_MESSAGING_UNSUPPORTED_SCHEMA', retryable: false }),
  handler_domain_rejection: Object.freeze({ code: 'MVT_MESSAGING_HANDLER_REJECTED', retryable: false }),
  handler_dependency_error: Object.freeze({ code: 'MVT_MESSAGING_HANDLER_DEPENDENCY', retryable: true }),
});

export class MessagingError extends Error {
  constructor(reason, { message, cause } = {}) {
    const definition = DEFINITIONS[reason];
    if (!definition) {
      throw new TypeError('Unknown messaging error reason');
    }
    super(normalizeMessage(message) || defaultMessage(reason), cause === undefined ? undefined : { cause });
    this.name = 'MessagingError';
    this.reason = reason;
    this.code = definition.code;
    this.retryable = definition.retryable;
  }
}

export function createMessagingError(reason, options) {
  return new MessagingError(reason, options);
}

export function classifyMessagingError(error) {
  if (error instanceof MessagingError) {
    return Object.freeze({
      reason: error.reason,
      code: error.code,
      retryable: error.retryable,
    });
  }

  if (error?.retryable === true) {
    return Object.freeze({
      reason: 'handler_dependency_error',
      code: DEFINITIONS.handler_dependency_error.code,
      retryable: true,
    });
  }

  return Object.freeze({
    reason: 'handler_domain_rejection',
    code: DEFINITIONS.handler_domain_rejection.code,
    retryable: false,
  });
}

export function isMessagingRetryableReason(reason) {
  return DEFINITIONS[reason]?.retryable === true;
}

function defaultMessage(reason) {
  switch (reason) {
    case 'connection_failure': return 'Messaging broker connection failed';
    case 'channel_closed': return 'Messaging broker channel closed';
    case 'publish_confirm_timeout': return 'Messaging publish confirmation timed out';
    case 'broker_nack': return 'Messaging broker rejected publication';
    case 'invalid_envelope': return 'Messaging envelope is invalid';
    case 'unsupported_schema': return 'Messaging schema version is unsupported';
    case 'handler_dependency_error': return 'Messaging handler dependency failed';
    default: return 'Messaging handler rejected the message';
  }
}

function normalizeMessage(value) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}
