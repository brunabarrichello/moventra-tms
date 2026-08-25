import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

const SAFE_OPERATION = /^[a-z][a-z0-9_.-]{0,79}$/;

export function getTracer(component = 'application') {
  return trace.getTracer(`moventra.${normalizeOperation(component)}`);
}

export function extractTraceContext(headers) {
  const carrier = normalizeHeaderCarrier(headers);
  try {
    return propagation.extract(context.active(), carrier);
  } catch {
    return context.active();
  }
}

export function runWithTraceContext(traceContext, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Trace context callback must be a function');
  }
  return context.with(traceContext ?? context.active(), callback);
}

export async function traceDatabaseOperation(operation, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Database tracing callback must be a function');
  }

  const normalizedOperation = normalizeOperation(operation);
  const tracer = getTracer('postgresql');

  return tracer.startActiveSpan(
    `postgresql.${normalizedOperation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'postgresql',
        'db.operation.name': normalizedOperation,
      },
    },
    async (span) => {
      try {
        const result = await callback();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setAttribute('error.type', safeErrorType(error));
        if (error?.code !== null && error?.code !== undefined) {
          span.setAttribute('moventra.error.code', String(error.code).slice(0, 120));
        }
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function activeSpanContext() {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) {
    return null;
  }
  return Object.freeze({
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  });
}

export function normalizeOperation(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SAFE_OPERATION.test(candidate) ? candidate : 'unknown';
}

function normalizeHeaderCarrier(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }

  const carrier = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      carrier[key.toLowerCase()] = value.join(',');
    } else if (value !== undefined && value !== null) {
      carrier[key.toLowerCase()] = String(value);
    }
  }
  return carrier;
}

function safeErrorType(error) {
  const value = typeof error?.name === 'string' && error.name.trim() ? error.name.trim() : 'Error';
  return value.slice(0, 120);
}
