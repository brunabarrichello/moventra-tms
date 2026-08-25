import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 020 uses official vendor-neutral OpenTelemetry dependencies with an exact lock', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const dependencies = packageJson.dependencies;

  for (const name of [
    '@opentelemetry/api',
    '@opentelemetry/sdk-node',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-metrics-otlp-http',
  ]) {
    assert.match(dependencies[name], /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages[''].dependencies[name], dependencies[name]);
  }

  const dependencyNames = Object.keys(dependencies).join(' ').toLowerCase();
  assert.doesNotMatch(dependencyNames, /datadog|newrelic|sentry|dynatrace|splunk/);
});

test('phase 020 exposes the internal observability facade and isolated request context', () => {
  const requestContext = read('src/infrastructure/observability/request-context.js');
  const telemetry = read('src/infrastructure/observability/telemetry.js');

  for (const path of [
    'src/infrastructure/observability/telemetry.js',
    'src/infrastructure/observability/request-context.js',
    'src/infrastructure/observability/logger.js',
    'src/infrastructure/observability/metrics.js',
    'src/infrastructure/observability/tracing.js',
    'src/infrastructure/observability/http.js',
  ]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }

  assert.match(requestContext, /AsyncLocalStorage/);
  assert.match(requestContext, /runWithRequestContext/);
  assert.match(telemetry, /NodeSDK/);
  assert.match(telemetry, /OTLPTraceExporter/);
  assert.match(telemetry, /OTLPMetricExporter/);
  assert.match(telemetry, /mode: 'degraded'/);
});

test('structured logs redact sensitive material and metrics reject high-cardinality identity labels', () => {
  const logger = read('src/infrastructure/observability/logger.js');
  const metrics = read('src/infrastructure/observability/metrics.js');

  assert.match(logger, /authorization\|cookie\|token\|password/);
  assert.match(logger, /database\[_-\]\?url/);
  assert.match(logger, /\[REDACTED_DATABASE_URL\]/);
  assert.match(metrics, /normalizeRouteTemplate/);
  assert.match(metrics, /status_class/);
  assert.match(metrics, /FEATURE_FLAG_REASONS/);

  for (const forbidden of ['tenantId', 'userId', 'requestId', 'traceId', 'entityId']) {
    assert.doesNotMatch(metrics, new RegExp(forbidden));
  }
});

test('HTTP, PostgreSQL and immutable Vercel output use observability without exposing SQL values', () => {
  const http = read('src/infrastructure/observability/http.js');
  const requestHandler = read('src/http/request-handler.js');
  const health = read('api/health.js');
  const databaseHealth = read('api/database-health.js');
  const postgres = read('src/infrastructure/database/postgres.js');
  const builder = read('scripts/ci/build-vercel-output.mjs');

  assert.match(http, /observeHttpRequest/);
  assert.match(http, /http\.route/);
  assert.match(requestHandler, /observeHttpRequest/);
  assert.match(health, /observeHttpRequest/);
  assert.match(databaseHealth, /observeHttpRequest/);
  assert.match(postgres, /traceDatabaseOperation/);
  assert.match(postgres, /databaseOperationName/);
  assert.doesNotMatch(postgres, /db\.statement|connectionString.*setAttribute/);
  assert.match(builder, /src.*infrastructure.*observability/);
  assert.match(builder, /process\.env\.APP_VERSION = BUILD_VERSION/);
});

test('phase 020 keeps telemetry outside transactional PostgreSQL and does not anticipate Error Handling 021', () => {
  const doc = read('docs/implementation/020-observabilidade-base.md');
  const migrationsDirectory = new URL('../../db/migrations/', import.meta.url);

  assert.equal(existsSync(new URL('0014_observability.sql', migrationsDirectory)), false);
  assert.match(doc, /não cria o catálogo\/contrato completo de Error Handling da fase 021/i);
  assert.match(doc, /A fase não substitui Audit/i);
  assert.match(doc, /não requer nova migration de banco por padrão/i);
  assert.match(doc, /Production.*gate humano/i);
});
