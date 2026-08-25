import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthenticationError,
  AuthorizationError,
  ConcurrencyError,
  ConflictError,
  DependencyError,
  DomainRuleError,
  InfrastructureError,
  MethodNotAllowedError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../../src/core/errors/app-error.js';
import { ERROR_CODES } from '../../src/core/errors/error-codes.js';
import { normalizeError, normalizePostgresError } from '../../src/core/errors/error-normalizer.js';
import { mapErrorToHttp } from '../../src/http/error-mapper.js';
import { createProblemDetails } from '../../src/http/problem-details.js';

const STATUS_CASES = [
  [new ValidationError(), 400],
  [new DomainRuleError(), 422],
  [new AuthenticationError(), 401],
  [new AuthorizationError(), 403],
  [new NotFoundError(), 404],
  [new ConflictError(), 409],
  [new ConcurrencyError(), 409],
  [new RateLimitError(), 429],
  [new DependencyError(), 503],
  [new TimeoutError(), 504],
  [new InfrastructureError(), 500],
  [new MethodNotAllowedError(), 405],
];

test('canonical error codes are unique and stable machine identifiers', () => {
  const codes = Object.values(ERROR_CODES);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/);
  }
});

test('canonical error categories map to deterministic HTTP statuses', () => {
  for (const [error, status] of STATUS_CASES) {
    assert.equal(mapErrorToHttp(error).status, status, error.name);
  }
});

test('unknown errors normalize to a sanitized internal error', () => {
  const databasePrefix = 'postgresql://sample-user';
  const databaseSuffix = ':sample-value@db.example/app';
  const original = new Error(`password=sample-value ${databasePrefix}${databaseSuffix}`);
  const normalized = normalizeError(original);
  const mapped = mapErrorToHttp(normalized);
  const problem = createProblemDetails(mapped.publicError, {
    status: mapped.status,
    instance: '/api/example',
    requestContext: { requestId: 'req-1', correlationId: 'corr-1' },
  });

  assert.equal(mapped.status, 500);
  assert.equal(problem.code, ERROR_CODES.INTERNAL_UNEXPECTED);
  assert.equal(problem.detail, 'Ocorreu um erro interno inesperado.');
  assert.equal(problem.requestId, 'req-1');
  assert.equal(problem.correlationId, 'corr-1');
  assert.equal(Object.hasOwn(problem, 'stack'), false);
  assert.equal(Object.hasOwn(problem, 'cause'), false);
  assert.doesNotMatch(JSON.stringify(problem), /sample-value|postgresql:\/\//i);
});

test('validation errors expose only normalized public field contracts', () => {
  const error = new ValidationError({
    validationErrors: [
      { field: 'customer.name', code: 'required', message: 'Campo obrigatório.' },
      { field: 'db.users.password', code: 'invalid value!', message: 'must be ignored' },
      { field: '../secret', code: 'INVALID', message: 'must be ignored' },
    ],
  });
  const problem = createProblemDetails(error, { status: 400 });

  assert.deepEqual(problem.errors, [
    { field: 'customer.name', code: 'REQUIRED', message: 'Campo obrigatório.' },
  ]);
});

test('PostgreSQL constraints are translated only through an explicit allowlist', () => {
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'uq_identity_external_provider_subject',
  });
  const constraintMappings = {
    uq_identity_external_provider_subject: {
      code: ERROR_CODES.RESOURCE_CONFLICT,
      publicMessage: 'A identidade externa já está vinculada.',
    },
  };

  const mapped = normalizePostgresError(pgError, { constraintMappings });
  assert.equal(mapped instanceof ConflictError, true);
  assert.equal(mapped.code, ERROR_CODES.RESOURCE_CONFLICT);
  assert.equal(mapped.publicMessage, 'A identidade externa já está vinculada.');

  const unmapped = normalizePostgresError(Object.assign(new Error('duplicate'), {
    code: '23505',
    constraint: 'unknown_constraint',
  }));
  assert.equal(unmapped instanceof InfrastructureError, true);
  assert.equal(unmapped.code, ERROR_CODES.INFRASTRUCTURE_FAILURE);
});

test('serialization and dependency errors carry explicit retry classification', () => {
  const serialization = normalizePostgresError(Object.assign(new Error('serialization'), { code: '40001' }));
  assert.equal(serialization.code, ERROR_CODES.CONCURRENCY_SERIALIZATION_FAILURE);
  assert.equal(serialization.retryable, true);
  assert.equal(serialization.retryStrategy, 'backoff');

  const dependency = normalizePostgresError(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }));
  assert.equal(dependency.code, ERROR_CODES.DEPENDENCY_UNAVAILABLE);
  assert.equal(dependency.retryable, true);
  assert.equal(dependency.retryStrategy, 'backoff');
});

test('authorization can be masked as not-found to prevent cross-tenant enumeration', () => {
  const mapped = mapErrorToHttp(new AuthorizationError(), { hideForbiddenAsNotFound: true });
  assert.equal(mapped.status, 404);
  assert.equal(mapped.internalError.code, ERROR_CODES.AUTHORIZATION_DENIED);
  assert.equal(mapped.publicError.code, ERROR_CODES.RESOURCE_NOT_FOUND);
});
