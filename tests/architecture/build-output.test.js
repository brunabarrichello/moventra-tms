import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureSha = '0123456789abcdef0123456789abcdef01234567';

test('Vercel Build Output API artifact embeds immutable revision identity and observed health contracts', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'moventra-build-output-'));
  const outputRoot = path.join(tempRoot, '.vercel', 'output');

  try {
    await execFileAsync(
      process.execPath,
      ['scripts/ci/build-vercel-output.mjs', outputRoot, fixtureSha],
      { cwd: root },
    );

    const config = JSON.parse(await readFile(path.join(outputRoot, 'config.json'), 'utf8'));
    assert.equal(config.version, 3);
    assert.deepEqual(config.routes, [
      { src: '^/health/?$', dest: '/api/health' },
      { src: '^/database-health/?$', dest: '/api/database-health' },
      { src: '^/api/database-health/?$', dest: '/api/database-health' },
    ]);

    const healthFunctionDir = path.join(outputRoot, 'functions', 'api', 'health.func');
    const healthFunctionConfig = JSON.parse(
      await readFile(path.join(healthFunctionDir, '.vc-config.json'), 'utf8'),
    );
    assert.equal(healthFunctionConfig.runtime, 'nodejs22.x');
    assert.equal(healthFunctionConfig.handler, 'index.js');

    const healthHandler = await readFile(path.join(healthFunctionDir, 'index.js'), 'utf8');
    assert.match(healthHandler, new RegExp(fixtureSha));
    assert.match(healthHandler, /process\.env\.APP_VERSION = BUILD_VERSION/);
    assert.match(healthHandler, /\.\/api\/health\.js/);

    const bundledHealthApi = await readFile(path.join(healthFunctionDir, 'api', 'health.js'), 'utf8');
    assert.match(bundledHealthApi, /observeHttpRequest/);
    assert.match(bundledHealthApi, /handleHttpError/);
    await access(
      path.join(healthFunctionDir, 'src', 'infrastructure', 'observability', 'telemetry.js'),
    );
    await access(path.join(healthFunctionDir, 'src', 'core', 'errors', 'app-error.js'));
    await access(path.join(healthFunctionDir, 'src', 'http', 'error-mapper.js'));
    await access(path.join(healthFunctionDir, 'src', 'http', 'problem-details.js'));
    await access(path.join(healthFunctionDir, 'node_modules', '@opentelemetry', 'api', 'package.json'));

    const databaseFunctionDir = path.join(outputRoot, 'functions', 'api', 'database-health.func');
    const databaseFunctionConfig = JSON.parse(
      await readFile(path.join(databaseFunctionDir, '.vc-config.json'), 'utf8'),
    );
    assert.equal(databaseFunctionConfig.runtime, 'nodejs22.x');
    assert.equal(databaseFunctionConfig.handler, 'index.js');

    const databaseHandler = await readFile(path.join(databaseFunctionDir, 'index.js'), 'utf8');
    assert.match(databaseHandler, new RegExp(fixtureSha));
    assert.match(databaseHandler, /process\.env\.APP_VERSION = BUILD_VERSION/);
    assert.match(databaseHandler, /\.\/api\/database-health\.js/);

    const bundledDatabaseApi = await readFile(
      path.join(databaseFunctionDir, 'api', 'database-health.js'),
      'utf8',
    );
    assert.match(bundledDatabaseApi, /checkDatabaseReadiness/);
    assert.match(bundledDatabaseApi, /classifyDatabaseHealthError/);
    assert.match(bundledDatabaseApi, /observeHttpRequest/);
    assert.match(bundledDatabaseApi, /handleHttpError/);
    assert.doesNotMatch(bundledDatabaseApi, /databaseName|serverVersionNum/);

    const bundledCore = await readFile(
      path.join(databaseFunctionDir, 'src', 'core', 'database-health.js'),
      'utf8',
    );
    assert.match(bundledCore, /configuration_missing/);
    assert.match(bundledCore, /authentication_failed/);
    assert.match(bundledCore, /connection_failed/);

    const bundledPostgres = await readFile(
      path.join(databaseFunctionDir, 'src', 'infrastructure', 'database', 'postgres.js'),
      'utf8',
    );
    assert.match(bundledPostgres, /traceDatabaseOperation/);
    assert.doesNotMatch(bundledPostgres, /db\.statement/);

    await access(path.join(databaseFunctionDir, 'src', 'core', 'errors', 'error-normalizer.js'));
    await access(path.join(databaseFunctionDir, 'src', 'http', 'problem-details.js'));
    await access(path.join(databaseFunctionDir, 'node_modules', 'pg', 'package.json'));
    await access(path.join(databaseFunctionDir, 'node_modules', '@vercel', 'functions', 'package.json'));
    await access(
      path.join(databaseFunctionDir, 'node_modules', '@opentelemetry', 'sdk-node', 'package.json'),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
