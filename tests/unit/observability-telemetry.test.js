import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOtlpConfiguration,
  buildResourceAttributes,
  getObservabilityState,
  initializeObservability,
  resetObservabilityForTest,
} from '../../src/infrastructure/observability/telemetry.js';

test('resource attributes use trusted service, revision and environment values', () => {
  const resource = buildResourceAttributes({
    APP_VERSION: '0123456789abcdef0123456789abcdef01234567',
    MOVENTRA_ENV: 'staging',
  });

  assert.deepEqual(resource, {
    'service.name': 'moventra-tms',
    'service.namespace': 'moventra',
    'service.version': '0123456789abcdef0123456789abcdef01234567',
    'deployment.environment.name': 'staging',
  });

  assert.equal(
    buildResourceAttributes({ MOVENTRA_ENV: 'client-value' })['deployment.environment.name'],
    'development',
  );
});

test('OTLP configuration is optional, validates endpoint and never requires exporter headers', () => {
  const disabled = buildOtlpConfiguration({ OTEL_SDK_DISABLED: 'true' });
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.endpoint, null);
  assert.equal(disabled.traces, 'none');
  assert.equal(disabled.metrics, 'none');
  assert.deepEqual(disabled.headers, {});

  const enabled = buildOtlpConfiguration({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.test/otel?ignored=true',
    OTEL_EXPORTER_OTLP_HEADERS: 'authorization=secret%20value,x-api-key=abc',
  });
  assert.equal(enabled.disabled, false);
  assert.equal(enabled.endpoint, 'https://collector.example.test/otel');
  assert.equal(enabled.traces, 'otlp');
  assert.equal(enabled.metrics, 'otlp');
  assert.deepEqual(enabled.headers, {
    authorization: 'secret value',
    'x-api-key': 'abc',
  });

  const credentialedEndpoint = buildOtlpConfiguration({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:password@collector.example.test',
  });
  assert.equal(credentialedEndpoint.endpoint, null);
  assert.equal(credentialedEndpoint.traces, 'none');
});

test('disabled observability initialization is idempotent and non-fatal', async () => {
  const previousDisabled = process.env.OTEL_SDK_DISABLED;
  process.env.OTEL_SDK_DISABLED = 'true';
  resetObservabilityForTest();

  try {
    const first = await initializeObservability();
    const second = await initializeObservability();
    assert.equal(first, second);
    assert.deepEqual(getObservabilityState(), { initialized: true, mode: 'disabled' });
  } finally {
    resetObservabilityForTest();
    if (previousDisabled === undefined) {
      delete process.env.OTEL_SDK_DISABLED;
    } else {
      process.env.OTEL_SDK_DISABLED = previousDisabled;
    }
  }
});
