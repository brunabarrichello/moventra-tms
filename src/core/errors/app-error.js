import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  getErrorDefinition,
} from './error-codes.js';

const RETRY_STRATEGIES = new Set(['none', 'immediate', 'backoff', 'external-reconcile']);

export class AppError extends Error {
  constructor({
    code,
    category,
    message,
    publicMessage,
    retryable = false,
    retryStrategy = 'none',
    metadataSafe = null,
    validationErrors = null,
    cause,
  }) {
    const definition = getErrorDefinition(code);
    const normalizedCode = definition === getErrorDefinition(ERROR_CODES.INTERNAL_UNEXPECTED)
      && code !== ERROR_CODES.INTERNAL_UNEXPECTED
      ? ERROR_CODES.INTERNAL_UNEXPECTED
      : code;
    const normalizedDefinition = getErrorDefinition(normalizedCode);
    const internalMessage = normalizeMessage(message) || normalizedDefinition.publicMessage;

    super(internalMessage, cause === undefined ? undefined : { cause });
    this.name = this.constructor.name;
    this.code = normalizedCode;
    this.category = category || normalizedDefinition.category;
    this.publicMessage = normalizeMessage(publicMessage) || normalizedDefinition.publicMessage;
    this.retryable = Boolean(retryable);
    this.retryStrategy = normalizeRetryStrategy(retryStrategy, this.retryable);
    this.metadataSafe = normalizeSafeMetadata(metadataSafe);
    this.validationErrors = normalizeValidationErrors(validationErrors);
  }
}

export class ValidationError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.VALIDATION_INVALID_INPUT,
      category: ERROR_CATEGORIES.VALIDATION,
      ...options,
    });
  }
}

export class DomainRuleError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.DOMAIN_RULE_VIOLATION,
      category: ERROR_CATEGORIES.DOMAIN_RULE,
      ...options,
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.AUTHENTICATION_REQUIRED,
      category: ERROR_CATEGORIES.AUTHENTICATION,
      ...options,
    });
  }
}

export class AuthorizationError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.AUTHORIZATION_DENIED,
      category: ERROR_CATEGORIES.AUTHORIZATION,
      ...options,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      category: ERROR_CATEGORIES.NOT_FOUND,
      ...options,
    });
  }
}

export class ConflictError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.RESOURCE_CONFLICT,
      category: ERROR_CATEGORIES.CONFLICT,
      ...options,
    });
  }
}

export class ConcurrencyError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.CONCURRENCY_VERSION_MISMATCH,
      category: ERROR_CATEGORIES.CONCURRENCY,
      ...options,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      category: ERROR_CATEGORIES.RATE_LIMIT,
      ...options,
    });
  }
}

export class DependencyError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      category: ERROR_CATEGORIES.DEPENDENCY,
      ...options,
    });
  }
}

export class TimeoutError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.DEPENDENCY_TIMEOUT,
      category: ERROR_CATEGORIES.TIMEOUT,
      retryable: true,
      retryStrategy: 'backoff',
      ...options,
    });
  }
}

export class InfrastructureError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.INFRASTRUCTURE_FAILURE,
      category: ERROR_CATEGORIES.INFRASTRUCTURE,
      ...options,
    });
  }
}

export class UnexpectedError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.INTERNAL_UNEXPECTED,
      category: ERROR_CATEGORIES.UNEXPECTED,
      ...options,
    });
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(options = {}) {
    super({
      code: ERROR_CODES.HTTP_METHOD_NOT_ALLOWED,
      category: ERROR_CATEGORIES.VALIDATION,
      ...options,
    });
  }
}

function normalizeRetryStrategy(value, retryable) {
  const candidate = typeof value === 'string' ? value.trim() : 'none';
  if (!RETRY_STRATEGIES.has(candidate)) {
    return retryable ? 'backoff' : 'none';
  }
  return retryable || candidate === 'none' ? candidate : 'none';
}

function normalizeMessage(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2_000) : '';
}

function normalizeSafeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      continue;
    }
    if (typeof item === 'string') {
      output[key] = item.slice(0, 300);
    } else if (typeof item === 'number' || typeof item === 'boolean' || item === null) {
      output[key] = item;
    }
  }
  return Object.keys(output).length ? Object.freeze(output) : null;
}

function normalizeValidationErrors(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const errors = value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const field = normalizePublicField(item.field);
    const code = normalizeValidationCode(item.code);
    const message = normalizeMessage(item.message);
    return field && code && message ? [{ field, code, message }] : [];
  });

  return errors.length ? Object.freeze(errors.map((item) => Object.freeze(item))) : null;
}

function normalizePublicField(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(candidate) ? candidate : null;
}

function normalizeValidationCode(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate) ? candidate : null;
}
