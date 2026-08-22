import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outputRootArg, commitSha] = process.argv.slice(2);
if (!outputRootArg || !/^[0-9a-f]{40}$/.test(commitSha ?? '')) {
  throw new Error('usage: node scripts/ci/build-vercel-output.mjs <output-root> <40-char-commit-sha>');
}

const root = process.cwd();
const outputRoot = path.resolve(outputRootArg);
const functionDir = path.join(outputRoot, 'functions', 'api', 'health.func');

await mkdir(path.join(functionDir, 'src', 'core'), { recursive: true });
await copyFile(path.join(root, 'src', 'core', 'health.js'), path.join(functionDir, 'src', 'core', 'health.js'));

const handler = `import { getHealthSnapshot } from './src/core/health.js';\n\nconst BUILD_VERSION = ${JSON.stringify(commitSha)};\n\nexport default function handler(_request, response) {\n  response.setHeader('cache-control', 'no-store');\n  response.status(200).json(getHealthSnapshot(BUILD_VERSION));\n}\n`;
await writeFile(path.join(functionDir, 'index.js'), handler, 'utf8');
await writeFile(path.join(functionDir, 'package.json'), '{\n  "type": "module"\n}\n', 'utf8');
await writeFile(
  path.join(functionDir, '.vc-config.json'),
  `${JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.js',
    maxDuration: 10,
    launcherType: 'Nodejs',
    shouldAddHelpers: true,
    shouldAddSourcemapSupport: true,
  }, null, 2)}\n`,
  'utf8',
);

await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, 'config.json'),
  `${JSON.stringify({
    version: 3,
    routes: [
      { src: '^/health/?$', dest: '/api/health' },
    ],
  }, null, 2)}\n`,
  'utf8',
);
