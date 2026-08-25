import { metrics } from '@opentelemetry/api';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const FEATURE_FLAG_SOURCES = new Set([
  'USER',
  'BRANCH',
  'COMPANY',
  'TENANT',
  'PLAN',
  'ENVIRONMENT_POLICY',
  'FLAG_DEFAULT',
  'UNKNOWN',
]);
const FEATURE_FLAG_TARGETS = new Set(['USER', 'BRANCH', 'COMPANY', 'TENANT', 'PLAN', 'UNKNOWN']);
const FEATURE_FLAG_REASONS = new Set([
  'flag_not_found',
  'flag_inactive',
  'context_invalid',
  'authorization_denied',
  'database_error',
  'evaluation_failed',
  'unknown',
]);
const FEATURE_FLAG_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/;
const IDEMPOTENCY_OPERATION_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/;
const IDEMPOTENCY_OUTCOMES = new Set(['executed', 'replayed', 'mismatch', 'failed']);
const RUNTIME_ENVIRONMENTS = new Set(['development', 'preview', 'staging', 'production']);

let instruments;

export function recordHttpRequest({ method, route, statusCode, durationMs, outcome }) {
  try {
    const current = getInstruments();
    const attributes = normalizeHttpMetricAttributes({ method, route, statusCode, outcome });
    current.httpRequests.add(1, attributes);
    current.httpDuration.record(normalizeDuration(durationMs), attributes);
    if (Number(statusCode) >= 500) {
      current.httpErrors.add(1, attributes);
    }
  } catch {
    // Metrics must never change request behavior.
  }
}

export function recordObservabilityExportError(signal) {
  try {
    getInstruments().exportErrors.add(1, {
      signal: ['traces', 'metrics', 'initialization', 'shutdown'].includes(signal) ? signal : 'unknown',
    });
  } catch {
    // Metrics must never change request behavior.
  }
}

export function recordFeatureFlagEvaluation({ flagKey, source, outcome, enabled }) {
  try {
    const current = getInstruments();
    const normalizedFlag = normalizeFeatureFlagKeyLabel(flagKey);
    current.featureFlagEvaluations.add(1, {
      flag: normalizedFlag,
      source: normalizeFeatureFlagSource(source),
      outcome: normalizeOutcome(outcome),
    });
    current.featureFlagRolloutBuckets.add(1, {
      flag: normalizedFlag,
      enabled: enabled === true ? 'true' : 'false',
    });
  } catch {
    // Feature flag behavior must not depend on telemetry.
  }
}

export function recordFeatureFlagEvaluationError({ flagKey, reason }) {
  try {
    getInstruments().featureFlagEvaluationErrors.add(1, {
      flag: normalizeFeatureFlagKeyLabel(flagKey),
      reason: normalizeFeatureFlagReason(reason),
    });
  } catch {
    // Feature flag behavior must not depend on telemetry.
  }
}

export function recordFeatureFlagRuleWrite({ targetType, outcome }) {
  try {
    getInstruments().featureFlagRuleWrites.add(1, {
      target: normalizeFeatureFlagTarget(targetType),
      outcome: normalizeOutcome(outcome),
    });
  } catch {
    // Feature flag behavior must not depend on telemetry.
  }
}

export function recordIdempotencyOperation({ operationKey, outcome, durationMs }) {
  try {
    const current = getInstruments();
    const attributes = {
      operation: normalizeIdempotencyOperationKey(operationKey),
      outcome: normalizeIdempotencyOutcome(outcome),
      environment: runtimeEnvironment(),
    };
    current.idempotencyRequests.add(1, attributes);
    current.idempotencyDuration.record(normalizeDuration(durationMs), attributes);
  } catch {
    // Idempotency correctness must never depend on telemetry.
  }
}

export function normalizeHttpMetricAttributes({ method, route, statusCode, outcome }) {
  const normalizedStatus = Number.isInteger(Number(statusCode)) ? Number(statusCode) : 0;
  return Object.freeze({
    method: normalizeHttpMethod(method),
    route: normalizeRouteTemplate(route),
    status_class: normalizedStatus >= 100 && normalizedStatus <= 599
      ? `${Math.floor(normalizedStatus / 100)}xx`
      : 'unknown',
    outcome: normalizeOutcome(outcome ?? (normalizedStatus >= 500 ? 'failure' : 'success')),
    environment: runtimeEnvironment(),
  });
}

export function normalizeRouteTemplate(value) {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const candidate = value.trim();
  if (!candidate || candidate.length > 160) {
    return 'unknown';
  }

  if (candidate === '/' || candidate === '/health' || candidate === '/api/database-health') {
    return candidate;
  }

  if (/^\/[a-zA-Z0-9_./:-]+$/.test(candidate) && candidate.includes(':')) {
    return candidate;
  }

  return 'unknown';
}

export function normalizeFeatureFlagReason(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : 'unknown';
  return FEATURE_FLAG_REASONS.has(candidate) ? candidate : 'unknown';
}

export function normalizeIdempotencyOperationKey(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return IDEMPOTENCY_OPERATION_KEY.test(candidate) && candidate.length <= 160
    ? candidate
    : 'unknown';
}

export function resetMetricInstrumentsForTest() {
  instruments = undefined;
}

function getInstruments() {
  if (instruments) {
    return instruments;
  }

  const meter = metrics.getMeter('moventra.observability');
  instruments = Object.freeze({
    httpRequests: meter.createCounter('http_server_requests_total'),
    httpDuration: meter.createHistogram('http_server_request_duration_ms', { unit: 'ms' }),
    httpErrors: meter.createCounter('http_server_errors_total'),
    exportErrors: meter.createCounter('observability_export_errors_total'),
    featureFlagEvaluations: meter.createCounter('feature_flag_evaluation_total'),
    featureFlagEvaluationErrors: meter.createCounter('feature_flag_evaluation_error_total'),
    featureFlagRuleWrites: meter.createCounter('feature_flag_rule_write_total'),
    featureFlagRolloutBuckets: meter.createCounter('feature_flag_rollout_bucket_total'),
    idempotencyRequests: meter.createCounter('idempotency_requests_total'),
    idempotencyDuration: meter.createHistogram('idempotency_duration_ms', { unit: 'ms' }),
  });
  return instruments;
}

function normalizeHttpMethod(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return HTTP_METHODS.has(candidate) ? candidate : 'OTHER';
}

function normalizeOutcome(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['success', 'failure', 'denied'].includes(candidate) ? candidate : 'unknown';
}

function normalizeFeatureFlagKeyLabel(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return FEATURE_FLAG_KEY.test(candidate) && candidate.length <= 160 ? candidate : 'unknown';
}

function normalizeFeatureFlagSource(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : 'UNKNOWN';
  return FEATURE_FLAG_SOURCES.has(candidate) ? candidate : 'UNKNOWN';
}

function normalizeFeatureFlagTarget(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : 'UNKNOWN';
  return FEATURE_FLAG_TARGETS.has(candidate) ? candidate : 'UNKNOWN';
}

function normalizeIdempotencyOutcome(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return IDEMPOTENCY_OUTCOMES.has(candidate) ? candidate : 'failed';
}

function normalizeDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function runtimeEnvironment() {
  const candidate = process.env.MOVENTRA_ENV?.trim()
    || process.env.VERCEL_TARGET_ENV?.trim()
    || process.env.VERCEL_ENV?.trim()
    || process.env.NODE_ENV?.trim()
    || 'development';
  const normalized = candidate.toLowerCase();
  return RUNTIME_ENVIRONMENTS.has(normalized) ? normalized : 'development';
}
