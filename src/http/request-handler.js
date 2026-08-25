import { getHealthSnapshot } from '../core/health.js';
import { observeHttpRequest } from '../infrastructure/observability/http.js';

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
      if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        sendJson(response, 200, getHealthSnapshot());
        return;
      }

      sendJson(response, 404, {
        status: 'error',
        code: 'NOT_FOUND',
      });
    },
  });
}

function routeTemplate(pathname) {
  if (pathname === '/' || pathname === '/health') {
    return pathname;
  }
  return 'unknown';
}
