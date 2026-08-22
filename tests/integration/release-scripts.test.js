import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const smokeScript = path.join(root, 'scripts/release/smoke-health.sh');
const deploymentUrlParser = path.join(root, 'scripts/release/vercel-deployment-url.sh');
const expectedSha = 'a'.repeat(40);

function runProcess(command, args, { env = {}, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });

    child.stdin.end(input);
  });
}

async function withServer(handler, run) {
  const server = createServer(handler);
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

function smokeEnv() {
  return {
    SMOKE_AUTH_MODE: 'http',
    SMOKE_ATTEMPTS: '1',
    SMOKE_DELAY_SECONDS: '0',
  };
}

test('release smoke accepts the exact healthy revision', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/health');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      status: 'ok',
      product: 'Moventra TMS',
      service: 'moventra-api',
      version: expectedSha,
    }));
  }, async (baseUrl) => {
    const result = await runProcess('bash', [smokeScript, baseUrl, expectedSha], {
      env: smokeEnv(),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /health smoke passed \(http\)/);
  });
});

test('release smoke does not follow an authentication redirect anonymously', async () => {
  let redirectedPageHits = 0;

  await withServer((request, response) => {
    if (request.url === '/health') {
      response.statusCode = 302;
      response.setHeader('location', '/sso');
      response.end('Redirecting...');
      return;
    }

    if (request.url === '/sso') {
      redirectedPageHits += 1;
      response.setHeader('content-type', 'text/html');
      response.end('x'.repeat(512 * 1024));
      return;
    }

    response.statusCode = 404;
    response.end();
  }, async (baseUrl) => {
    const result = await runProcess('bash', [smokeScript, baseUrl, expectedSha], {
      env: smokeEnv(),
    });

    assert.equal(result.code, 69);
    assert.equal(redirectedPageHits, 0);
    assert.doesNotMatch(result.stderr, /Argument list too long/);
  });
});

test('release smoke handles a large invalid body without using argv or environment payload transport', async () => {
  await withServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('x'.repeat(512 * 1024));
  }, async (baseUrl) => {
    const result = await runProcess('bash', [smokeScript, baseUrl, expectedSha], {
      env: smokeEnv(),
    });

    assert.equal(result.code, 69);
    assert.match(result.stderr, /health smoke failed after 1 attempts/);
    assert.doesNotMatch(result.stderr, /Argument list too long/);
  });
});

test('Vercel output parser preserves the immutable deployment URL before mutable aliases', async () => {
  const immutableUrl = 'https://moventra-qdeqqgj3y-alebru.vercel.app';
  const output = [
    'Vercel CLI 59.3.0',
    'Inspect https://vercel.com/alebru/moventra-tms/HCh9jAeUNvD3FeSkeLB8TP48wkVv',
    `Production ${immutableUrl}`,
    'Building…',
    '▲ Aliased https://moventra-tms.vercel.app',
    '▲ Aliased https://moventra-tms-alebru.vercel.app',
  ].join('\n');

  const result = await runProcess('bash', [deploymentUrlParser], { input: output });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), immutableUrl);
});
