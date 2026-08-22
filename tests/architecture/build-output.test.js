import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    assert.deepEqual(config.routes, [{ src: '^/health/?$', dest: '/api/health' }]);

    const functionDir = path.join(outputRoot, 'functions', 'api', 'health.func');
    const functionConfig = JSON.parse(await readFile(path.join(functionDir, '.vc-config.json'), 'utf8'));
    assert.equal(functionConfig.runtime, 'nodejs22.x');
    assert.equal(functionConfig.handler, 'index.js');

    const handler = await readFile(path.join(functionDir, 'index.js'), 'utf8');
    assert.match(handler, new RegExp(fixtureSha));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
