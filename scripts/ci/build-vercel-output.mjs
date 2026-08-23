import { cp, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outputRootArg, commitSha] = process.argv.slice(2);
if (!outputRootArg || !/^[0-9a-f]{40}$/.test(commitSha ?? '')) {
  throw new Error('usage: node scripts/ci/build-vercel-output.mjs <output-root> <40-char-commit-sha>');
}

const root = process.cwd();
const outputRoot = path.resolve(outputRootArg);
const healthFunctionDir = path.join(outputRoot, 'functions', 'api', 'health.func');
const databaseHealthFunctionDir = path.join(outputRoot, 'functions', 'api', 'database-health.func');

await buildHealthFunction();
await buildDatabaseHealthFunction();

await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, 'config.json'),
  `${JSON.stringify({
    version: 3,
    routes: [
      { src: '^/health/?$', dest: '/api/health' },
      { src: '^/database-health/?$', dest: '/api/database-health' },
      { src: '^/api/database-health/?$', dest: '/api/database-health' },
    ],
  }, null, 2)}\n`,
  'utf8',
);

async function buildHealthFunction() {
  await mkdir(path.join(healthFunctionDir, 'src', 'core'), { recursive: true });
  await copyFile(
    path.join(root, 'src', 'core', 'health.js'),
    path.join(healthFunctionDir, 'src', 'core', 'health.js'),
  );

  const handler = `import { getHealthSnapshot } from './src/core/health.js';\n\nconst BUILD_VERSION = ${JSON.stringify(commitSha)};\n\nexport default function handler(_request, response) {\n  response.setHeader('cache-control', 'no-store');\n  response.status(200).json(getHealthSnapshot(BUILD_VERSION));\n}\n`;
  await writeFile(path.join(healthFunctionDir, 'index.js'), handler, 'utf8');
  await writeFunctionMetadata(healthFunctionDir);
}

async function buildDatabaseHealthFunction() {
  const coreDir = path.join(databaseHealthFunctionDir, 'src', 'core');
  const databaseDir = path.join(databaseHealthFunctionDir, 'src', 'infrastructure', 'database');

  await mkdir(coreDir, { recursive: true });
  await mkdir(databaseDir, { recursive: true });

  await copyFile(
    path.join(root, 'src', 'core', 'database-health.js'),
    path.join(coreDir, 'database-health.js'),
  );
  await copyFile(
    path.join(root, 'src', 'infrastructure', 'database', 'postgres.js'),
    path.join(databaseDir, 'postgres.js'),
  );

  await cp(path.join(root, 'node_modules'), path.join(databaseHealthFunctionDir, 'node_modules'), {
    recursive: true,
  });

  const handler = `import { classifyDatabaseHealthError, getDatabaseHealthSnapshot } from './src/core/database-health.js';\nimport { checkDatabaseReadiness } from './src/infrastructure/database/postgres.js';\n\nconst BUILD_VERSION = ${JSON.stringify(commitSha)};\n\nexport default async function handler(request, response) {\n  response.setHeader('cache-control', 'no-store');\n\n  if ((request.method ?? 'GET') !== 'GET') {\n    response.setHeader('allow', 'GET');\n    response.status(405).json({ status: 'error', code: 'METHOD_NOT_ALLOWED' });\n    return;\n  }\n\n  try {\n    const readiness = await checkDatabaseReadiness();\n    const snapshot = getDatabaseHealthSnapshot(readiness, BUILD_VERSION);\n    response.status(snapshot.status === 'ready' ? 200 : 503).json(snapshot);\n  } catch (error) {\n    const reason = classifyDatabaseHealthError(error);\n    console.error('Database readiness probe failed', { name: error?.name, code: error?.code, reason });\n    response.status(503).json(getDatabaseHealthSnapshot({ ok: false }, BUILD_VERSION, reason));\n  }\n}\n`;

  await writeFile(path.join(databaseHealthFunctionDir, 'index.js'), handler, 'utf8');
  await writeFunctionMetadata(databaseHealthFunctionDir);
}

async function writeFunctionMetadata(functionDir) {
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
}
