import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deployScriptUrl = new URL('../../scripts/release/vercel-deploy-artifact.sh', import.meta.url);

test('fresh prebuilt deployment keeps runtime secrets out of the CI transport path', async () => {
  const script = await readFile(deployScriptUrl, 'utf8');

  assert.match(script, /deploy --prebuilt --prod --yes --token/);
  assert.doesNotMatch(script, /vercel env run/);
  assert.doesNotMatch(script, /vercel env pull/);
  assert.doesNotMatch(script, /--env "DATABASE_URL=/);
  assert.doesNotMatch(script, /\.env\.production\.local/);
});
