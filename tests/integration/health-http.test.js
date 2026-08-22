import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { requestHandler } from '../../src/http/request-handler.js';

async function withServer(run) {
  const server = createServer(requestHandler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

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

    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.product, 'Moventra TMS');
    assert.equal(body.service, 'moventra-api');
  });
});

test('unknown routes fail closed with 404', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      status: 'error',
      code: 'NOT_FOUND',
    });
  });
});
