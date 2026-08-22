import { getHealthSnapshot } from '../core/health.js';

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

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    sendJson(response, 200, getHealthSnapshot());
    return;
  }

  sendJson(response, 404, {
    status: 'error',
    code: 'NOT_FOUND',
  });
}
