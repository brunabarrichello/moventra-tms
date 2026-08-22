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

test('Vercel Build Output API artifact embeds immutable revision identity', async () => {
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

    const databaseFunctionDir = path.join(outputRoot, 'functions', 'api', 'database-health.func');
    const databaseFunctionConfig = JSON.parse(
      await readFile(path.join(databaseFunctionDir, '.vc-config.json'), 'utf8'),
    );
    assert.equal(databaseFunctionConfig.runtime, 'nodejs22.x');
    assert.equal(databaseFunctionConfig.handler, 'index.js');

    const databaseHandler = await readFile(path.join(databaseFunctionDir, 'index.js'), 'utf8');
    assert.match(databaseHandler, new RegExp(fixtureSha));
    assert.match(databaseHandler, /checkDatabaseReadiness/);
    assert.doesNotMatch(databaseHandler, /databaseName|serverVersionNum/);

    await access(path.join(databaseFunctionDir, 'node_modules', 'pg', 'package.json'));
    await access(path.join(databaseFunctionDir, 'node_modules', '@vercel', 'functions', 'package.json'));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
