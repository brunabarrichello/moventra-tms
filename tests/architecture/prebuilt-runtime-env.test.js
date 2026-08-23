import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deployScriptUrl = new URL('../../scripts/release/vercel-deploy-artifact.sh', import.meta.url);

test('prebuilt deployment resolves DATABASE_URL at deployment time without dotenv persistence', async () => {
  const script = await readFile(deployScriptUrl, 'utf8');

  assert.match(script, /vercel@\$\{vercel_cli_version\}" env run/);
  assert.match(script, /--environment=production/);
  assert.match(script, /DATABASE_URL is required in the Vercel production environment/);
  assert.match(script, /--env "DATABASE_URL=\$\{DATABASE_URL\}"/);
  assert.doesNotMatch(script, /vercel env pull/);
  assert.doesNotMatch(script, /\.env\.production\.local/);
});
