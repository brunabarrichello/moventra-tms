import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

test('PostgreSQL runtime dependencies are exact and Vercel Fluid is enabled', async () => {
  const packageJson = await readJson('package.json');
  const vercelConfig = await readJson('vercel.json');

  assert.equal(packageJson.dependencies.pg, '8.23.0');
  assert.equal(packageJson.dependencies['@vercel/functions'], '3.9.3');
  assert.equal(vercelConfig.fluid, true);
});

test('PostgreSQL runtime adapter encapsulates pooling, channel binding and transaction boundaries', async () => {
  const source = await readFile(
    path.join(root, 'src/infrastructure/database/postgres.js'),
    'utf8',
  );

  assert.match(source, /new Pool\(/);
  assert.match(source, /enableChannelBinding:\s*true/);
  assert.match(source, /attachDatabasePool\(pool\)/);
  assert.match(source, /process\.env\.DATABASE_URL/);
  assert.match(source, /client\.query\('BEGIN'\)/);
  assert.match(source, /client\.query\('COMMIT'\)/);
  assert.match(source, /client\.query\('ROLLBACK'\)/);
  assert.match(source, /client\.release\(\)/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*DATABASE_URL/);
});

test('core remains independent from PostgreSQL and Vercel infrastructure', async () => {
  const coreDirectory = path.join(root, 'src/core');
  const entries = await readdir(coreDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }

    const source = await readFile(path.join(coreDirectory, entry.name), 'utf8');
    assert.doesNotMatch(source, /from ['"]pg['"]/);
    assert.doesNotMatch(source, /@vercel\/functions/);
    assert.doesNotMatch(source, /infrastructure\/database/);
  }
});
