import { metrics, trace } from '@opentelemetry/api';
import { createLogger } from '../../infrastructure/observability/logger.js';

const OPERATIONS = new Set(['connect', 'publish', 'consume', 'ack', 'nack', 'close']);
const OUTCOMES = new Set(['success', 'empty', 'retryable_error', 'rejected', 'timeout', 'failed']);
const ENVIRONMENTS = new Set(['development', 'preview', 'staging', 'production']);
const logger = createLogger('messaging');
let instruments;

export function recordMessagingOperation({ operation, outcome, durationMs = 0 }) {
  try {
    const attributes = normalizeMessagingMetricAttributes({ operation, outcome });
    const current = getInstruments();
    current.operations.add(1, attributes);
    current.duration.record(normalizeDuration(durationMs), attributes);
    if (attributes.operation === 'connect') {
      current.connections.add(1, { outcome: attributes.outcome, environment: attributes.environment });
    }
    if (['consume', 'ack', 'nack'].includes(attributes.operation)) {
      current.deliveries.add(1, { outcome: attributes.outcome, environment: attributes.environment });
    }

    const span = trace.getActiveSpan();
    span?.setAttribute('moventra.messaging.operation', attributes.operation);
    span?.setAttribute('moventra.messaging.outcome', attributes.outcome);

    logger.info('Messaging operation completed', {
      event: 'messaging.operation.completed',
      operation: attributes.operation,
      outcome: attributes.outcome,
      durationMs: Math.round(normalizeDuration(durationMs) * 100) / 100,
    });
  } catch {
    // Messaging correctness must never depend on telemetry.
  }
}

export function normalizeMessagingMetricAttributes({ operation, outcome }) {
  const normalizedOperation = typeof operation === 'string' ? operation.trim().toLowerCase() : '';
  const normalizedOutcome = typeof outcome === 'string' ? outcome.trim().toLowerCase() : '';
  return Object.freeze({
    operation: OPERATIONS.has(normalizedOperation) ? normalizedOperation : 'unknown',
    outcome: OUTCOMES.has(normalizedOutcome) ? normalizedOutcome : 'failed',
    environment: runtimeEnvironment(),
  });
}

export function resetMessagingMetricInstrumentsForTest() {
  instruments = undefined;
}

function getInstruments() {
  if (instruments) {
    return instruments;
  }
  const meter = metrics.getMeter('moventra.messaging');
  instruments = Object.freeze({
    operations: meter.createCounter('messaging_operations_total'),
    duration: meter.createHistogram('messaging_operation_duration_ms', { unit: 'ms' }),
    connections: meter.createCounter('messaging_connections_total'),
    deliveries: meter.createCounter('messaging_deliveries_total'),
  });
  return instruments;
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
  return ENVIRONMENTS.has(normalized) ? normalized : 'development';
}
