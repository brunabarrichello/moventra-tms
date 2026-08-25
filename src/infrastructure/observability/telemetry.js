import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const DISCARD_SPAN_EXPORTER = Object.freeze({
  export(_spans, callback) {
    callback({ code: 0 });
  },
  async shutdown() {},
  async forceFlush() {},
});

let initializationPromise;
let sdk;
let state = Object.freeze({ initialized: false, mode: 'uninitialized' });

export function initializeObservability() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = initializeInternal();
  return initializationPromise;
}

export async function shutdownObservability({ timeoutMs = 2_500 } = {}) {
  const activeSdk = sdk;
  sdk = undefined;

  if (!activeSdk) {
    return;
  }

  try {
    await withTimeout(activeSdk.shutdown(), timeoutMs);
  } catch (error) {
    bootstrapLog('warn', 'observability.shutdown.failed', error);
  }
}

export function getObservabilityState() {
  return state;
}

export function buildResourceAttributes(environment = process.env) {
  return Object.freeze({
    'service.name': 'moventra-tms',
    'service.namespace': 'moventra',
    'service.version': runtimeVersion(environment),
    'deployment.environment.name': runtimeEnvironment(environment),
  });
}

export function buildOtlpConfiguration(environment = process.env) {
  const endpoint = normalizeOtlpEndpoint(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
  const traces = normalizeExporterSelection(environment.OTEL_TRACES_EXPORTER, endpoint);
  const metrics = normalizeExporterSelection(environment.OTEL_METRICS_EXPORTER, endpoint);

  return Object.freeze({
    disabled: String(environment.OTEL_SDK_DISABLED ?? '').trim().toLowerCase() === 'true',
    endpoint,
    traces,
    metrics,
    headers: parseOtlpHeaders(environment.OTEL_EXPORTER_OTLP_HEADERS),
  });
}

async function initializeInternal() {
  const configuration = buildOtlpConfiguration(process.env);
  if (configuration.disabled) {
    state = Object.freeze({ initialized: true, mode: 'disabled' });
    return state;
  }

  try {
    const options = {
      autoDetectResources: true,
      resource: resourceFromAttributes(buildResourceAttributes(process.env)),
    };

    if (configuration.traces === 'otlp') {
      options.traceExporter = new OTLPTraceExporter({
        url: signalEndpoint(configuration.endpoint, 'traces'),
        headers: configuration.headers,
      });
    } else {
      // Register a real provider/context manager while keeping export explicitly local/no-op.
      // This prevents the NodeSDK default OTLP exporter from dialing localhost when no endpoint exists.
      options.spanProcessors = [new SimpleSpanProcessor(DISCARD_SPAN_EXPORTER)];
    }

    if (configuration.metrics === 'otlp') {
      options.metricReader = new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: signalEndpoint(configuration.endpoint, 'metrics'),
          headers: configuration.headers,
          concurrencyLimit: 1,
        }),
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: 10_000,
      });
    }

    const activeSdk = new NodeSDK(options);
    await Promise.resolve(activeSdk.start());
    sdk = activeSdk;
    state = Object.freeze({
      initialized: true,
      mode: configuration.traces === 'otlp' || configuration.metrics === 'otlp' ? 'otlp' : 'local-noop',
      traces: configuration.traces,
      metrics: configuration.metrics,
    });
    return state;
  } catch (error) {
    state = Object.freeze({ initialized: true, mode: 'degraded' });
    bootstrapLog('warn', 'observability.initialize.failed', error);
    return state;
  }
}

function normalizeOtlpEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeExporterSelection(value, endpoint) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (candidate === 'none') {
    return 'none';
  }
  if ((candidate === '' || candidate === 'otlp') && endpoint) {
    return 'otlp';
  }
  return 'none';
}

function parseOtlpHeaders(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return Object.freeze({});
  }

  const output = {};
  for (const item of value.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = decodeHeaderPart(item.slice(0, separator)).trim();
    const headerValue = decodeHeaderPart(item.slice(separator + 1)).trim();
    if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,120}$/.test(key) && headerValue.length <= 2_000) {
      output[key] = headerValue;
    }
  }
  return Object.freeze(output);
}

function signalEndpoint(endpoint, signal) {
  const suffix = signal === 'metrics' ? '/v1/metrics' : '/v1/traces';
  return `${endpoint}${suffix}`;
}

function runtimeVersion(environment) {
  return environment.APP_VERSION?.trim() || environment.VERCEL_GIT_COMMIT_SHA?.trim() || 'development';
}

function runtimeEnvironment(environment) {
  const raw = environment.MOVENTRA_ENV?.trim()
    || environment.VERCEL_TARGET_ENV?.trim()
    || environment.VERCEL_ENV?.trim()
    || environment.NODE_ENV?.trim()
    || 'development';
  const normalized = raw.toLowerCase();
  return ['development', 'preview', 'staging', 'production'].includes(normalized)
    ? normalized
    : 'development';
}

function decodeHeaderPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function bootstrapLog(level, event, error) {
  try {
    const writer = level === 'warn' ? console.warn : console.error;
    writer(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'moventra-tms',
      event,
      error: {
        type: typeof error?.name === 'string' ? error.name.slice(0, 120) : 'Error',
        code: error?.code === undefined || error?.code === null ? null : String(error.code).slice(0, 120),
      },
    }));
  } catch {
    // Bootstrap observability failure must stay non-fatal.
  }
}

async function withTimeout(promise, timeoutMs) {
  const bounded = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2_500;
  let timer;
  try {
    await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Observability shutdown timeout')), bounded);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
