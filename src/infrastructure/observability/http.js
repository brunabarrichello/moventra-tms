import { performance } from 'node:perf_hooks';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from './logger.js';
import { recordHttpRequest } from './metrics.js';
import {
  createRequestContext,
  runWithRequestContext,
  setActiveTraceContext,
} from './request-context.js';
import { initializeObservability } from './telemetry.js';
import {
  extractTraceContext,
  getTracer,
  runWithTraceContext,
} from './tracing.js';

const httpLogger = createLogger('http');

export async function observeHttpRequest({ request, response, route, handler }) {
  if (typeof handler !== 'function') {
    throw new TypeError('Observed HTTP handler must be a function');
  }

  await initializeObservability();

  const method = normalizeMethod(request?.method);
  const routeTemplate = normalizeRoute(route);
  const requestContext = createRequestContext(request?.headers);
  setResponseCorrelationHeaders(response, requestContext);
  const parentContext = extractTraceContext(request?.headers);
  const tracer = getTracer('http');

  return runWithTraceContext(parentContext, () => tracer.startActiveSpan(
    `HTTP ${method} ${routeTemplate}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': method,
        'http.route': routeTemplate,
      },
    },
    async (span) => runWithRequestContext(requestContext, async () => {
      const spanContext = span.spanContext();
      setActiveTraceContext(spanContext);
      const startedAt = performance.now();
      let outcome = 'success';

      try {
        const result = await handler();
        const statusCode = normalizeStatusCode(response?.statusCode);
        if (statusCode >= 500) {
          outcome = 'failure';
          span.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        return result;
      } catch (error) {
        outcome = 'failure';
        span.setAttribute('error.type', safeErrorType(error));
        if (error?.code !== undefined && error?.code !== null) {
          span.setAttribute('moventra.error.code', String(error.code).slice(0, 120));
        }
        span.setStatus({ code: SpanStatusCode.ERROR });
        httpLogger.error('HTTP request failed', {
          event: 'http.request.failed',
          method,
          route: routeTemplate,
          statusCode: normalizeStatusCode(response?.statusCode),
          error: error instanceof Error ? error : new Error('Unexpected request error'),
        });
        throw error;
      } finally {
        const durationMs = performance.now() - startedAt;
        const statusCode = normalizeStatusCode(response?.statusCode);
        span.setAttribute('http.response.status_code', statusCode);
        span.setAttribute('moventra.outcome', outcome);
        recordHttpRequest({ method, route: routeTemplate, statusCode, durationMs, outcome });
        httpLogger.info('HTTP request completed', {
          event: 'http.request.completed',
          method,
          route: routeTemplate,
          statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          outcome,
        });
        span.end();
      }
    }),
  ));
}

function setResponseCorrelationHeaders(response, requestContext) {
  if (!response || typeof response.setHeader !== 'function') {
    return;
  }

  try {
    response.setHeader('x-request-id', requestContext.requestId);
    response.setHeader('x-correlation-id', requestContext.correlationId);
  } catch {
    // Correlation headers are observability metadata and must never break the response.
  }
}

function normalizeMethod(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : 'GET';
  return /^[A-Z]{3,12}$/.test(candidate) ? candidate : 'OTHER';
}

function normalizeRoute(value) {
  if (value === '/' || value === '/health' || value === '/api/database-health') {
    return value;
  }
  if (typeof value === 'string' && /^\/[A-Za-z0-9_./:-]{1,159}$/.test(value) && value.includes(':')) {
    return value;
  }
  return 'unknown';
}

function normalizeStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : 500;
}

function safeErrorType(error) {
  return typeof error?.name === 'string' && error.name.trim() ? error.name.trim().slice(0, 120) : 'Error';
}
