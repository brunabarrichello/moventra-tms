import { metrics, trace } from '@opentelemetry/api';
import { createLogger } from '../../infrastructure/observability/logger.js';
import { normalizeJobType } from './job-contract.js';

const OPERATIONS = new Set(['schedule', 'claim', 'heartbeat', 'execute', 'complete', 'retry', 'reap', 'cancel']);
const OUTCOMES = new Set(['success', 'empty', 'retryable_error', 'rejected', 'conflict', 'failed']);
const ENVIRONMENTS = new Set(['development', 'preview', 'staging', 'production']);
const logger = createLogger('jobs');
let instruments;

export function recordJobOperation({ operation, outcome, jobType = 'system.unknown', durationMs = 0 }) {
  try {
    const attributes = normalizeJobMetricAttributes({ operation, outcome, jobType });
    const current = getInstruments();
    current.operations.add(1, attributes);
    current.duration.record(normalizeDuration(durationMs), attributes);
    const span = trace.getActiveSpan();
    span?.setAttribute('moventra.jobs.operation', attributes.operation);
    span?.setAttribute('moventra.jobs.outcome', attributes.outcome);
    span?.setAttribute('moventra.jobs.job_type', attributes.job_type);
    logger.info('Job operation completed', {
      event: 'jobs.operation.completed',
      operation: attributes.operation,
      outcome: attributes.outcome,
      jobType: attributes.job_type,
      durationMs: Math.round(normalizeDuration(durationMs) * 100) / 100,
    });
  } catch {
    // Job correctness must never depend on telemetry.
  }
}

export function normalizeJobMetricAttributes({ operation, outcome, jobType }) {
  const normalizedOperation = typeof operation === 'string' ? operation.trim().toLowerCase() : '';
  const normalizedOutcome = typeof outcome === 'string' ? outcome.trim().toLowerCase() : '';
  let normalizedType = 'system.unknown';
  try {
    normalizedType = normalizeJobType(jobType);
  } catch {
    // Keep controlled fallback.
  }
  return Object.freeze({
    operation: OPERATIONS.has(normalizedOperation) ? normalizedOperation : 'execute',
    outcome: OUTCOMES.has(normalizedOutcome) ? normalizedOutcome : 'failed',
    job_type: normalizedType,
    environment: runtimeEnvironment(),
  });
}

export function resetJobMetricInstrumentsForTest() {
  instruments = undefined;
}

function getInstruments() {
  if (instruments) {
    return instruments;
  }
  const meter = metrics.getMeter('moventra.jobs');
  instruments = Object.freeze({
    operations: meter.createCounter('jobs_operations_total'),
    duration: meter.createHistogram('jobs_operation_duration_ms', { unit: 'ms' }),
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
