import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowFiles = [
  '.github/workflows/foundation-ci.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release-gate.yml',
  '.github/workflows/rollback-drill.yml',
  '.github/workflows/production-promotion.yml',
];

const approvedActions = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'], // v7.0.1
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'], // v6.5.0
  ['actions/download-artifact', '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'], // v8.0.1
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'], // v7.0.1
]);

const retiredNode20Pins = [
  '11d5960a326750d5838078e36cf38b85af677262', // checkout v4.4.0
  '49933ea5288caeca8642d1e84afbd3f7d6820020', // setup-node v4.4.0
  'd3f86a106a0bac45b974a628896c90dbdf5c8093', // download-artifact v4.3.0
  'ea165f8d65b6e75b540449e92b4886f43607fa02', // upload-artifact v4.6.2
];

test('foundation workflows pin only approved Node 24 compatible GitHub Actions', async () => {
  let setupNodeCount = 0;
  let packageManagerCacheDisabledCount = 0;

  for (const relativePath of workflowFiles) {
    const workflow = await readFile(path.join(root, relativePath), 'utf8');

    for (const retiredPin of retiredNode20Pins) {
      assert.doesNotMatch(workflow, new RegExp(retiredPin), `${relativePath} still references retired Node 20 action ${retiredPin}`);
    }

    for (const match of workflow.matchAll(/^\s*uses:\s+(actions\/[^@\s]+)@([^\s]+)(?:\s+#.*)?$/gm)) {
      const [, action, ref] = match;
      assert.match(ref, /^[0-9a-f]{40}$/, `${relativePath} must pin ${action} by full commit SHA`);

      const approvedRef = approvedActions.get(action);
      if (approvedRef) {
        assert.equal(ref, approvedRef, `${relativePath} uses an unapproved revision for ${action}`);
      }
    }

    setupNodeCount += (workflow.match(/uses:\s+actions\/setup-node@/g) ?? []).length;
    packageManagerCacheDisabledCount += (workflow.match(/package-manager-cache:\s+false/g) ?? []).length;
  }

  assert.ok(setupNodeCount > 0, 'Moventra CI must configure Node explicitly');
  assert.equal(
    packageManagerCacheDisabledCount,
    setupNodeCount,
    'every setup-node use must explicitly disable automatic package-manager caching',
  );
});

test('Vercel npx invocations suppress npm deprecation noise without suppressing Vercel failures', async () => {
  for (const relativePath of [
    'scripts/release/smoke-health.sh',
    'scripts/release/vercel-deploy-artifact.sh',
  ]) {
    const script = await readFile(path.join(root, relativePath), 'utf8');
    assert.match(script, /NPM_CONFIG_LOGLEVEL=error/, `${relativePath} must suppress npm-only warning noise`);
    assert.match(script, /VERCEL_TELEMETRY_DISABLED=1/, `${relativePath} must disable Vercel telemetry output`);
    assert.doesNotMatch(script, /2>\/dev\/null[^\n]*npx/, `${relativePath} must not discard Vercel stderr`);
  }
});
