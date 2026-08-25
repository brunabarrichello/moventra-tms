import {
  AppError,
  ConflictError,
  ConcurrencyError,
  DependencyError,
  InfrastructureError,
  UnexpectedError,
} from './app-error.js';
import { ERROR_CODES } from './error-codes.js';

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
]);
const CONCURRENCY_ERROR_CODES = new Set(['40001', '40P01']);
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

export function normalizeError(error, options = {}) {
  if (error instanceof AppError) {
    return error;
  }

  if (isPostgresLikeError(error)) {
    return normalizePostgresError(error, options);
  }

  if (error instanceof Error) {
    return new UnexpectedError({
      message: 'Unexpected application error',
      cause: error,
    });
  }

  return new UnexpectedError({
    message: 'Unexpected non-Error throwable',
  });
}

export function normalizePostgresError(error, { constraintMappings = {} } = {}) {
  const pgCode = safeCode(error?.code);
  const constraint = safeConstraintName(error?.constraint);
  const mappedConstraint = constraint ? constraintMappings[constraint] : null;

  if (mappedConstraint && pgCode === UNIQUE_VIOLATION) {
    return new ConflictError({
      code: mappedConstraint.code || ERROR_CODES.RESOURCE_CONFLICT,
      message: 'Known PostgreSQL unique constraint violation',
      publicMessage: mappedConstraint.publicMessage,
      metadataSafe: mappedConstraint.metadataSafe,
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (mappedConstraint && pgCode === FOREIGN_KEY_VIOLATION) {
    return new ConflictError({
      code: mappedConstraint.code || ERROR_CODES.RESOURCE_CONFLICT,
      message: 'Known PostgreSQL foreign key constraint violation',
      publicMessage: mappedConstraint.publicMessage,
      metadataSafe: mappedConstraint.metadataSafe,
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (CONCURRENCY_ERROR_CODES.has(pgCode)) {
    return new ConcurrencyError({
      code: ERROR_CODES.CONCURRENCY_SERIALIZATION_FAILURE,
      message: 'PostgreSQL transaction serialization/deadlock failure',
      retryable: true,
      retryStrategy: 'backoff',
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (CONNECTION_ERROR_CODES.has(pgCode)) {
    return new DependencyError({
      message: 'PostgreSQL dependency unavailable',
      retryable: true,
      retryStrategy: 'backoff',
      cause: error instanceof Error ? error : undefined,
    });
  }

  return new InfrastructureError({
    message: 'Unmapped PostgreSQL infrastructure failure',
    cause: error instanceof Error ? error : undefined,
  });
}

function isPostgresLikeError(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const code = safeCode(value.code);
  if (!code) {
    return false;
  }
  return /^[0-9A-Z]{5}$/.test(code) || CONNECTION_ERROR_CODES.has(code);
}

function safeCode(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase().slice(0, 32);
}

function safeConstraintName(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();
  return /^[a-z][a-z0-9_]{0,127}$/.test(candidate) ? candidate : null;
}
