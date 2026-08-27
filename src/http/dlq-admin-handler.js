import { MethodNotAllowedError, ValidationError } from '../core/errors/app-error.js';
import { observeHttpRequest } from '../infrastructure/observability/http.js';
import { getRequestContext } from '../infrastructure/observability/request-context.js';
import { handleHttpError } from './error-mapper.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const ROUTES = Object.freeze({
  list: Object.freeze({ method: 'GET', template: '/api/v1/dlq/entries' }),
  detail: Object.freeze({ method: 'GET', template: '/api/v1/dlq/entries/:id' }),
  reprocess: Object.freeze({ method: 'POST', template: '/api/v1/dlq/entries/:id/reprocess' }),
  resolve: Object.freeze({ method: 'POST', template: '/api/v1/dlq/entries/:id/resolve' }),
  discard: Object.freeze({ method: 'POST', template: '/api/v1/dlq/entries/:id/discard' }),
});

export function createDlqAdminHttpHandler({ service, assertionVerifier }) {
  assertDependencies(service, assertionVerifier);
  return async function dlqAdminHttpHandler(request, response) {
    let route;
    try {
      route = resolveRoute(request);
    } catch (error) {
      route = Object.freeze({ action: 'invalid', method: 'GET', template: 'unknown', instance: '/api/v1/dlq/entries', routeError: error });
    }
    return observeHttpRequest({
      request,
      response,
      route: route.template,
      handler: async () => {
        try {
          if (route.routeError) {
            throw route.routeError;
          }
          const method = String(request?.method ?? 'GET').toUpperCase();
          if (method !== route.method) {
            throw new MethodNotAllowedError({ message: `Method ${method} is not allowed on this DLQ route` });
          }
          const tenantId = requireHeader(request, 'x-moventra-tenant-id', 'Tenant header is required');
          const verifiedAssertion = await assertionVerifier.verifyRequest(request);
          const context = getRequestContext();
          const common = {
            tenantId,
            verifiedAssertion,
            requestId: context?.requestId,
            correlationId: context?.correlationId,
          };

          if (route.action === 'list') {
            const result = await service.list({ ...common, filters: {
              status: queryValue(request, 'status'),
              sourceKind: queryValue(request, 'source_kind'),
              limit: queryValue(request, 'limit'),
              cursor: queryValue(request, 'cursor'),
            } });
            sendJson(response, 200, result);
            return;
          }
          if (route.action === 'detail') {
            const result = await service.get({ ...common, id: route.id });
            setEtag(response, result?.version);
            sendJson(response, 200, result);
            return;
          }

          assertNoRequestBody(request);
          const expectedVersion = parseIfMatch(requireHeader(request, 'if-match', 'If-Match is required for DLQ mutation'));
          const idempotencyKey = requireHeader(request, 'idempotency-key', 'Idempotency-Key is required for DLQ mutation');
          const result = await service[route.action]({ ...common, id: route.id, expectedVersion, idempotencyKey });
          const body = result?.idempotency ? result.value : result;
          const status = result?.idempotency?.status ?? 200;
          setEtag(response, body?.entry?.version);
          if (result?.idempotency) {
            response.setHeader('x-idempotency-outcome', result.idempotency.outcome);
          }
          sendJson(response, status, body);
        } catch (error) {
          handleHttpError({
            error,
            request,
            response,
            instance: route.instance,
            allow: error instanceof MethodNotAllowedError ? route.method : undefined,
          });
        }
      },
    });
  };
}

export function resolveRoute(request) {
  const url = requestUrl(request);
  const action = queryValueFromUrl(url, 'dlq_action');
  const rewrittenId = queryValueFromUrl(url, 'dlq_id');
  if (action && Object.hasOwn(ROUTES, action)) {
    const contract = ROUTES[action];
    return Object.freeze({
      action,
      id: action === 'list' ? null : requireRouteId(rewrittenId),
      method: contract.method,
      template: contract.template,
      instance: externalInstance(action, rewrittenId),
    });
  }
  const pathname = url.pathname;
  if (pathname === '/api/v1/dlq/entries') {
    return Object.freeze({ action: 'list', id: null, ...ROUTES.list, instance: pathname });
  }
  const match = /^\/api\/v1\/dlq\/entries\/([0-9a-fA-F-]{36})(?:\/(reprocess|resolve|discard))?$/.exec(pathname);
  if (!match) {
    throw new ValidationError({ message: 'DLQ Admin route is invalid' });
  }
  const actionName = match[2] ?? 'detail';
  return Object.freeze({ action: actionName, id: requireRouteId(match[1]), ...ROUTES[actionName], instance: pathname });
}

function assertDependencies(service, verifier) {
  if (!service || ['list', 'get', 'reprocess', 'resolve', 'discard'].some((method) => typeof service[method] !== 'function')) {
    throw new TypeError('DLQ Admin HTTP handler requires the complete service contract');
  }
  if (!verifier || typeof verifier.verifyRequest !== 'function') {
    throw new TypeError('DLQ Admin HTTP handler requires an assertion verifier');
  }
}

function requestUrl(request) { return new URL(request?.url ?? '/', 'http://localhost'); }
function queryValue(request, name) { return queryValueFromUrl(requestUrl(request), name); }
function queryValueFromUrl(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) { throw new ValidationError({ message: `Query parameter ${name} must appear at most once` }); }
  return values[0] ?? null;
}
function requireHeader(request, name, message) {
  const value = readHeader(request?.headers, name);
  if (Array.isArray(value)) {
    if (value.length !== 1) { throw new ValidationError({ message }); }
    return requireHeaderValue(String(value[0]), message);
  }
  return requireHeaderValue(value, message);
}
function requireHeaderValue(value, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\r\n\0]/.test(value)) {
    throw new ValidationError({ message });
  }
  return value.trim();
}
function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') { return undefined; }
  if (typeof headers.get === 'function') { return headers.get(name) ?? undefined; }
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}
function parseIfMatch(value) {
  const match = /^"v([1-9][0-9]*)"$/.exec(value);
  if (!match) { throw new ValidationError({ message: 'If-Match must use the strong ETag format "v<positive-version>"' }); }
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) { throw new ValidationError({ message: 'If-Match version exceeds the supported range' }); }
  return version;
}
function setEtag(response, version) {
  const normalized = Number(version);
  if (Number.isSafeInteger(normalized) && normalized > 0 && typeof response?.setHeader === 'function') {
    response.setHeader('etag', `"v${normalized}"`);
  }
}
function assertNoRequestBody(request) {
  const contentLength = readHeader(request?.headers, 'content-length');
  const transferEncoding = readHeader(request?.headers, 'transfer-encoding');
  if (transferEncoding || (contentLength && Number(contentLength) > 0)) {
    throw new ValidationError({ message: 'DLQ administrative mutations do not accept a request body' });
  }
  const body = request?.body;
  if (body !== undefined && body !== null && body !== '' && !(typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)) {
    throw new ValidationError({ message: 'DLQ administrative mutations do not accept a request body' });
  }
}
function sendJson(response, status, body) {
  response.setHeader('content-type', JSON_CONTENT_TYPE);
  response.setHeader('cache-control', 'no-store');
  if (typeof response.status === 'function' && typeof response.json === 'function') { response.status(status).json(body); return; }
  response.statusCode = status;
  response.end(JSON.stringify(body));
}
function requireRouteId(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)) {
    throw new ValidationError({ message: 'DLQ entry id must be a canonical UUID' });
  }
  return candidate;
}
function externalInstance(action, id) {
  if (action === 'list') { return '/api/v1/dlq/entries'; }
  const suffix = action === 'detail' ? '' : `/${action}`;
  return `/api/v1/dlq/entries/${id ?? ':id'}${suffix}`;
}
