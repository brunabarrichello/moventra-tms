import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeFeatureFlagReason,
  normalizeHttpMetricAttributes,
  normalizeIdempotencyOperationKey,
  normalizeRouteTemplate,
} from '../../src/infrastructure/observability/metrics.js';

test('HTTP metric labels use route templates and bounded status classes', () => {
  const previousEnvironment = process.env.MOVENTRA_ENV;
  process.env.MOVENTRA_ENV = 'staging';

  try {
    assert.deepEqual(
      normalizeHttpMetricAttributes({
        method: 'get',
        route: '/api/v1/trips/:id',
        statusCode: 503,
        outcome: 'failure',
      }),
      {
        method: 'GET',
        route: '/api/v1/trips/:id',
        status_class: '5xx',
        outcome: 'failure',
        environment: 'staging',
      },
    );
  } finally {
    if (previousEnvironment === undefined) {
      delete process.env.MOVENTRA_ENV;
    } else {
      process.env.MOVENTRA_ENV = previousEnvironment;
    }
  }
});

test('raw entity paths and uncontrolled environments collapse to safe labels', () => {
  const previousEnvironment = process.env.MOVENTRA_ENV;
  process.env.MOVENTRA_ENV = 'customer-controlled-environment';

  try {
    const attributes = normalizeHttpMetricAttributes({
      method: 'CUSTOM',
      route: '/api/v1/trips/01990190-0000-7000-8000-000000000001',
      statusCode: 200,
    });
    assert.equal(attributes.method, 'OTHER');
    assert.equal(attributes.route, 'unknown');
    assert.equal(attributes.environment, 'development');
  } finally {
    if (previousEnvironment === undefined) {
      delete process.env.MOVENTRA_ENV;
    } else {
      process.env.MOVENTRA_ENV = previousEnvironment;
    }
  }

  assert.equal(normalizeRouteTemplate('/health'), '/health');
  assert.equal(normalizeRouteTemplate('/arbitrary/uuid-value'), 'unknown');
});

test('feature flag evaluation error reasons are an allowlisted low-cardinality set', () => {
  assert.equal(normalizeFeatureFlagReason('flag_not_found'), 'flag_not_found');
  assert.equal(normalizeFeatureFlagReason('database_error'), 'database_error');
  assert.equal(normalizeFeatureFlagReason('tenant-01990190-uuid-specific-error'), 'unknown');
});

test('idempotency metric operation labels accept only controlled namespaced keys', () => {
  assert.equal(normalizeIdempotencyOperationKey('freight.contract.create'), 'freight.contract.create');
  assert.equal(normalizeIdempotencyOperationKey('Freight.Contract.Create'), 'freight.contract.create');
  assert.equal(normalizeIdempotencyOperationKey('tenant-01990220-uuid-specific-operation'), 'unknown');
  assert.equal(normalizeIdempotencyOperationKey('free form'), 'unknown');
});
