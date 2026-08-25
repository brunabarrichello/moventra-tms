import { getRequestContext } from '../infrastructure/observability/request-context.js';
import { getErrorDefinition } from '../core/errors/error-codes.js';

const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';
const TYPE_BASE_URL = 'https://api.moventra/errors/';

export function createProblemDetails(error, { status, instance, requestContext } = {}) {
  const definition = getErrorDefinition(error?.code);
  const context = requestContext ?? getRequestContext();
  const body = {
    type: `${TYPE_BASE_URL}${encodeURIComponent(error.code)}`,
    title: definition.title,
    status,
    detail: error.publicMessage || definition.publicMessage,
    code: error.code,
  };

  const normalizedInstance = normalizeInstance(instance);
  if (normalizedInstance) {
    body.instance = normalizedInstance;
  }
  if (context?.requestId) {
    body.requestId = context.requestId;
  }
  if (context?.correlationId) {
    body.correlationId = context.correlationId;
  }
  if (error?.validationErrors?.length) {
    body.errors = error.validationErrors.map(({ field, code, message }) => ({ field, code, message }));
  }
  if (error?.retryable === true) {
    body.retryable = true;
  }

  return body;
}

export function sendProblemDetails(response, problem, { allow, retryAfter } = {}) {
  if (!response || typeof response !== 'object') {
    throw new TypeError('HTTP response is required');
  }

  setHeader(response, 'content-type', PROBLEM_CONTENT_TYPE);
  setHeader(response, 'cache-control', 'no-store');
  if (allow) {
    setHeader(response, 'allow', normalizeHeaderValue(allow, 100));
  }
  if (retryAfter !== undefined && retryAfter !== null) {
    const normalized = normalizeRetryAfter(retryAfter);
    if (normalized) {
      setHeader(response, 'retry-after', normalized);
    }
  }

  const status = Number(problem?.status);
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new TypeError('Problem Details status must be a 4xx/5xx HTTP status');
  }

  if (typeof response.status === 'function' && typeof response.json === 'function') {
    response.status(status).json(problem);
    return;
  }

  response.statusCode = status;
  if (typeof response.writeHead === 'function' && !response.headersSent) {
    response.writeHead(status);
  }
  if (typeof response.end === 'function') {
    response.end(JSON.stringify(problem));
    return;
  }

  throw new TypeError('Unsupported HTTP response implementation');
}

function setHeader(response, name, value) {
  if (!value || typeof response.setHeader !== 'function' || response.headersSent) {
    return;
  }
  response.setHeader(name, value);
}

function normalizeInstance(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.length > 256 || /[\r\n\0]/.test(candidate)) {
    return null;
  }
  return candidate;
}

function normalizeHeaderValue(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();
  return candidate && candidate.length <= maxLength && !/[\r\n\0]/.test(candidate) ? candidate : null;
}

function normalizeRetryAfter(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 86_400) {
    return String(value);
  }
  return normalizeHeaderValue(value, 100);
}
