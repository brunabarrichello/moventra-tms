import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { requestHandler } from '../../src/http/request-handler.js';

async function withServer(run) {
  const server = createServer(requestHandler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /health returns a healthy Moventra API response', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.match(response.headers.get('x-request-id') ?? '', /.+/);
    assert.match(response.headers.get('x-correlation-id') ?? '', /.+/);

    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.product, 'Moventra TMS');
    assert.equal(body.service, 'moventra-api');
  });
});

test('unknown routes fail closed with RFC Problem Details without implementation leakage', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/does-not-exist`, {
      headers: { 'x-correlation-id': 'integration-correlation-1' },
    });
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);

    const body = await response.json();
    assert.equal(body.type, 'https://api.moventra/errors/RESOURCE.NOT_FOUND');
    assert.equal(body.title, 'Recurso não encontrado');
    assert.equal(body.status, 404);
    assert.equal(body.code, 'RESOURCE.NOT_FOUND');
    assert.equal(body.instance, '/does-not-exist');
    assert.equal(body.correlationId, 'integration-correlation-1');
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(Object.hasOwn(body, 'stack'), false);
    assert.equal(Object.hasOwn(body, 'cause'), false);
  });
});

test('known health route rejects unsupported methods with 405 and Allow', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);

    const body = await response.json();
    assert.equal(body.code, 'HTTP.METHOD_NOT_ALLOWED');
    assert.equal(body.status, 405);
    assert.equal(body.instance, '/health');
  });
});
