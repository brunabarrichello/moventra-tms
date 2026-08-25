import { metrics, trace } from '@opentelemetry/api';
import { createLogger } from '../../infrastructure/observability/logger.js';

const OPERATIONS = new Set(['append', 'claim', 'mark_published']);
const OUTCOMES = new Set(['success', 'empty', 'conflict', 'failed']);
const ENVIRONMENTS = new Set(['development', 'preview', 'staging', 'production']);
const logger = createLogger('outbox');
let instruments;

export function recordOutboxOperation({ operation, outcome, durationMs }) {
  try {
    const attributes = normalizeOutboxMetricAttributes({ operation, outcome });
    const current = getInstruments();
    current.operations.add(1, attributes);
    current.duration.record(normalizeDuration(durationMs), attributes);

    const span = trace.getActiveSpan();
    span?.setAttribute('moventra.outbox.operation', attributes.operation);
    span?.setAttribute('moventra.outbox.outcome', attributes.outcome);

    logger.info('Outbox operation completed', {
      event: 'outbox.operation.completed',
      operation: attributes.operation,
      outcome: attributes.outcome,
      durationMs: Math.round(normalizeDuration(durationMs) * 100) / 100,
    });
  } catch {
    // Outbox correctness must never depend on telemetry.
  }
}

export function normalizeOutboxMetricAttributes({ operation, outcome }) {
  const normalizedOperation = typeof operation === 'string' ? operation.trim().toLowerCase() : '';
  const normalizedOutcome = typeof outcome === 'string' ? outcome.trim().toLowerCase() : '';
  return Object.freeze({
    operation: OPERATIONS.has(normalizedOperation) ? normalizedOperation : 'unknown',
    outcome: OUTCOMES.has(normalizedOutcome) ? normalizedOutcome : 'failed',
    environment: runtimeEnvironment(),
  });
}

export function resetOutboxMetricInstrumentsForTest() {
  instruments = undefined;
}

function getInstruments() {
  if (instruments) return instruments;
  const meter = metrics.getMeter('moventra.outbox');
  instruments = Object.freeze({
    operations: meter.createCounter('outbox_operations_total'),
    duration: meter.createHistogram('outbox_operation_duration_ms', { unit: 'ms' }),
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
