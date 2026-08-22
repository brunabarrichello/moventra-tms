import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const coreDir = path.join(root, 'src/core');

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
}

test('core does not depend on transport or Node HTTP infrastructure', async () => {
  for (const entry of await javascriptFiles(coreDir)) {
    const source = await readFile(path.join(coreDir, entry.name), 'utf8');
    assert.doesNotMatch(source, /node:http/);
    assert.doesNotMatch(source, /\.\.\/http\//);
  }
});
