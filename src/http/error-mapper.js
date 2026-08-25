import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
} from '../core/errors/error-codes.js';
import {
  NotFoundError,
} from '../core/errors/app-error.js';
import { normalizeError } from '../core/errors/error-normalizer.js';
import { createLogger } from '../infrastructure/observability/logger.js';
import { createProblemDetails, sendProblemDetails } from './problem-details.js';

const errorLogger = createLogger('error-handler');

export function mapErrorToHttp(error, {
  hideForbiddenAsNotFound = false,
  constraintMappings,
} = {}) {
  const normalized = normalizeError(error, { constraintMappings });
  if (hideForbiddenAsNotFound && normalized.category === ERROR_CATEGORIES.AUTHORIZATION) {
    const masked = new NotFoundError({ message: 'Authorization failure masked as resource not found' });
    return { internalError: normalized, publicError: masked, status: 404 };
  }

  return {
    internalError: normalized,
    publicError: normalized,
    status: statusFor(normalized),
  };
}

export function handleHttpError({
  error,
  request,
  response,
  instance,
  hideForbiddenAsNotFound = false,
  constraintMappings,
  allow,
  retryAfter,
}) {
  if (response?.headersSent) {
    logHandledError(normalizeError(error, { constraintMappings }), 500, request);
    return false;
  }

  const mapped = mapErrorToHttp(error, { hideForbiddenAsNotFound, constraintMappings });
  const problem = createProblemDetails(mapped.publicError, {
    status: mapped.status,
    instance,
  });

  annotateActiveSpan(mapped.internalError, mapped.status);
  logHandledError(mapped.internalError, mapped.status, request);
  sendProblemDetails(response, problem, { allow, retryAfter });
  return true;
}

function statusFor(error) {
  if (error.code === ERROR_CODES.HTTP_METHOD_NOT_ALLOWED) {
    return 405;
  }

  switch (error.category) {
    case ERROR_CATEGORIES.VALIDATION:
      return 400;
    case ERROR_CATEGORIES.DOMAIN_RULE:
      return 422;
    case ERROR_CATEGORIES.AUTHENTICATION:
      return 401;
    case ERROR_CATEGORIES.AUTHORIZATION:
      return 403;
    case ERROR_CATEGORIES.NOT_FOUND:
      return 404;
    case ERROR_CATEGORIES.CONFLICT:
    case ERROR_CATEGORIES.CONCURRENCY:
      return 409;
    case ERROR_CATEGORIES.RATE_LIMIT:
      return 429;
    case ERROR_CATEGORIES.DEPENDENCY:
      return 503;
    case ERROR_CATEGORIES.TIMEOUT:
      return 504;
    case ERROR_CATEGORIES.INFRASTRUCTURE:
    case ERROR_CATEGORIES.UNEXPECTED:
    default:
      return 500;
  }
}

function annotateActiveSpan(error, status) {
  try {
    const span = trace.getActiveSpan();
    if (!span) {
      return;
    }
    span.setAttribute('error.type', error.name || 'AppError');
    span.setAttribute('moventra.error.code', error.code);
    span.setAttribute('moventra.error.category', error.category);
    if (status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  } catch {
    // Error telemetry must never break the error response.
  }
}

function logHandledError(error, status, request) {
  const metadata = {
    event: 'http.error.handled',
    method: normalizeMethod(request?.method),
    statusCode: status,
    outcome: 'failure',
    error: {
      type: error.name,
      code: error.code,
      message: error.message,
    },
    retryable: error.retryable,
    retryStrategy: error.retryStrategy,
  };

  if (status >= 500) {
    errorLogger.error('HTTP error handled', metadata);
  } else if (status === 429 || status === 409) {
    errorLogger.warn('HTTP error handled', metadata);
  } else {
    errorLogger.info('HTTP error handled', metadata);
  }
}

function normalizeMethod(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : 'GET';
  return /^[A-Z]{3,12}$/.test(candidate) ? candidate : 'OTHER';
}
