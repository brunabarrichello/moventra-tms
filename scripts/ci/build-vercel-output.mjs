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
  await copyRuntimeModuleTree(healthFunctionDir, {
    apiFile: 'health.js',
    includeDatabase: false,
  });

  await writeFile(
    path.join(healthFunctionDir, 'index.js'),
    buildImmutableApiWrapper('./api/health.js'),
    'utf8',
  );
  await writeFunctionMetadata(healthFunctionDir);
}

async function buildDatabaseHealthFunction() {
  await copyRuntimeModuleTree(databaseHealthFunctionDir, {
    apiFile: 'database-health.js',
    includeDatabase: true,
  });

  await writeFile(
    path.join(databaseHealthFunctionDir, 'index.js'),
    buildImmutableApiWrapper('./api/database-health.js'),
    'utf8',
  );
  await writeFunctionMetadata(databaseHealthFunctionDir);
}

async function copyRuntimeModuleTree(functionDir, { apiFile, includeDatabase }) {
  const apiDir = path.join(functionDir, 'api');
  const coreDir = path.join(functionDir, 'src', 'core');
  const coreErrorsDir = path.join(coreDir, 'errors');
  const httpDir = path.join(functionDir, 'src', 'http');
  const observabilityDir = path.join(functionDir, 'src', 'infrastructure', 'observability');

  await mkdir(apiDir, { recursive: true });
  await mkdir(coreDir, { recursive: true });
  await mkdir(path.dirname(observabilityDir), { recursive: true });

  await copyFile(path.join(root, 'api', apiFile), path.join(apiDir, apiFile));
  await copyFile(path.join(root, 'src', 'core', 'health.js'), path.join(coreDir, 'health.js'));
  await cp(path.join(root, 'src', 'core', 'errors'), coreErrorsDir, { recursive: true });
  await cp(path.join(root, 'src', 'http'), httpDir, { recursive: true });
  await cp(
    path.join(root, 'src', 'infrastructure', 'observability'),
    observabilityDir,
    { recursive: true },
  );

  if (includeDatabase) {
    await copyFile(
      path.join(root, 'src', 'core', 'database-health.js'),
      path.join(coreDir, 'database-health.js'),
    );
    const databaseDir = path.join(functionDir, 'src', 'infrastructure', 'database');
    await mkdir(databaseDir, { recursive: true });
    await copyFile(
      path.join(root, 'src', 'infrastructure', 'database', 'postgres.js'),
      path.join(databaseDir, 'postgres.js'),
    );
  }

  // Error Handling + OpenTelemetry are part of observed functions; keep prebuilt functions self-contained.
  await cp(path.join(root, 'node_modules'), path.join(functionDir, 'node_modules'), {
    recursive: true,
  });
}

function buildImmutableApiWrapper(apiModule) {
  return `import handler from ${JSON.stringify(apiModule)};\n\nconst BUILD_VERSION = ${JSON.stringify(commitSha)};\nprocess.env.APP_VERSION = BUILD_VERSION;\n\nexport default handler;\n`;
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
