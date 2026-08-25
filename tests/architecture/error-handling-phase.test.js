import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 021 has centralized error modules and keeps core independent from HTTP', () => {
  const paths = [
    'src/core/errors/app-error.js',
    'src/core/errors/error-codes.js',
    'src/core/errors/error-normalizer.js',
    'src/http/problem-details.js',
    'src/http/error-mapper.js',
  ];
  for (const path of paths) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }

  const core = paths.slice(0, 3).map(read).join('\n');
  assert.doesNotMatch(core, /from ['"].*\/http\//);
  assert.match(read('src/core/errors/app-error.js'), /retryStrategy/);
});

test('phase 021 centralizes Problem Details and HTTP mapping', () => {
  const problem = read('src/http/problem-details.js');
  const mapper = read('src/http/error-mapper.js');
  const handler = read('src/http/request-handler.js');

  assert.match(problem, /application\/problem\+json/);
  assert.match(problem, /api\.moventra\/errors/);
  assert.match(mapper, /mapErrorToHttp/);
  assert.match(mapper, /handleHttpError/);
  assert.match(handler, /handleHttpError/);
});

test('phase 021 uses allowlisted PostgreSQL translation and packages runtime modules', () => {
  const normalizer = read('src/core/errors/error-normalizer.js');
  const builder = read('scripts/ci/build-vercel-output.mjs');

  assert.match(normalizer, /constraintMappings/);
  assert.match(normalizer, /UNIQUE_VIOLATION/);
  assert.match(normalizer, /FOREIGN_KEY_VIOLATION/);
  assert.match(normalizer, /CONCURRENCY_ERROR_CODES/);
  assert.match(builder, /src.*core.*errors/);
  assert.match(builder, /src.*http/);
});

test('phase 021 does not create persistence or activate Idempotency 022', () => {
  const doc = read('docs/implementation/021-error-handling.md');
  const migrationsDirectory = new URL('../../db/migrations/', import.meta.url);

  assert.equal(existsSync(new URL('0014_error_handling.sql', migrationsDirectory)), false);
  assert.equal(existsSync(new URL('0014_idempotency.sql', migrationsDirectory)), false);
  assert.match(doc, /não requer migration por padrão/i);
  assert.match(doc, /022 — Idempotência.*NOT ACTIVE/i);
});
