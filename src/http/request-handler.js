import { getHealthSnapshot } from '../core/health.js';
import {
  MethodNotAllowedError,
  NotFoundError,
} from '../core/errors/app-error.js';
import { observeHttpRequest } from '../infrastructure/observability/http.js';
import { handleHttpError } from './error-mapper.js';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

export function requestHandler(request, response) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  const route = routeTemplate(url.pathname);

  return observeHttpRequest({
    request,
    response,
    route,
    handler: async () => {
      try {
        if (url.pathname === '/' || url.pathname === '/health') {
          if (method !== 'GET') {
            throw new MethodNotAllowedError({ message: `Method ${method} is not allowed on health route` });
          }
          sendJson(response, 200, getHealthSnapshot());
          return;
        }

        throw new NotFoundError({ message: 'Requested HTTP route was not found' });
      } catch (error) {
        handleHttpError({
          error,
          request,
          response,
          instance: url.pathname,
          allow: error instanceof MethodNotAllowedError ? 'GET' : undefined,
        });
      }
    },
  });
}

function routeTemplate(pathname) {
  if (pathname === '/' || pathname === '/health') {
    return pathname;
  }
  return 'unknown';
}
