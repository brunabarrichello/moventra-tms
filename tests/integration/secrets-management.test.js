import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('dotenv template contains names only and no secret values', async () => {
  const template = await read('.env.example');
  const assignments = template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  assert.ok(assignments.length > 0, '.env.example must declare configuration names');

  for (const assignment of assignments) {
    assert.match(assignment, /^[A-Z][A-Z0-9_]*=$/, `template assignment must be empty: ${assignment}`);
  }

  for (const required of [
    'VERCEL_TOKEN=',
    'DATABASE_URL=',
    'MIGRATIONS_DATABASE_URL=',
    'MESSAGING_RABBITMQ_URL=',
    'OTEL_TRACES_EXPORTER=',
    'OTEL_METRICS_EXPORTER=',
    'OTEL_SDK_DISABLED=',
  ]) {
    assert.ok(assignments.includes(required), `.env.example is missing ${required}`);
  }

  assert.ok(!assignments.includes('VERCEL_STAGING_PROJECT_ID='));
  assert.ok(!assignments.includes('JOBS_DEFAULT_MAX_ATTEMPTS='));
});

test('tracked files exclude dotenv secrets, private keys and credential exports', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

  const forbidden = [
    /(^|\/)\.env($|\.)/,
    /(^|\/)(id_rsa|id_ed25519)$/,
    /\.key$/,
    /\.pem$/,
    /\.p12$/,
    /\.pfx$/,
    /(^|\/)credentials\.json$/,
    /(^|\/)service-account[^/]*\.json$/,
    /(^|\/)secrets\//,
    /\.secret$/,
  ];

  for (const file of tracked) {
    if (file === '.env.example') {
      continue;
    }
    for (const pattern of forbidden) {
      assert.doesNotMatch(file, pattern, `forbidden secret material is tracked: ${file}`);
    }
  }
});

test('gitignore protects local secret material while allowing the empty template', async () => {
  const gitignore = await read('.gitignore');
  for (const required of ['.env', '.env.*', '!.env.example', '*.key', '*.pem', '*.p12', '*.pfx', 'secrets/']) {
    assert.ok(gitignore.includes(required), `.gitignore is missing ${required}`);
  }
});

test('deployment credentials are scoped to protected GitHub environments', async () => {
  const bootstrap = await read('.github/workflows/bootstrap-vercel-staging.yml');
  const staging = await read('.github/workflows/release-gate.yml');
  const rollback = await read('.github/workflows/rollback-drill.yml');
  const production = await read('.github/workflows/production-promotion.yml');

  for (const workflow of [bootstrap, staging, rollback]) {
    assert.match(workflow, /environment:\s*staging/);
    assert.match(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/);
    assert.match(workflow, /VERCEL_ORG_ID:\s*\$\{\{\s*vars\.VERCEL_ORG_ID\s*\}\}/);
  }

  assert.match(bootstrap, /VERCEL_PROJECT_NAME:\s*moventra-tms-staging/);
  assert.match(bootstrap, /ensure-vercel-project\.sh/);
  assert.doesNotMatch(bootstrap, /workflows:\s*\["Moventra CI"\]/);

  assert.match(staging, /VERCEL_PROJECT_NAME:\s*moventra-tms-staging/);
  assert.match(staging, /VERCEL_NODE_VERSION:\s*22\.x/);
  assert.match(staging, /DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/);
  assert.match(staging, /MIGRATIONS_DATABASE_URL:\s*\$\{\{\s*secrets\.MIGRATIONS_DATABASE_URL\s*\}\}/);
  assert.match(staging, /MESSAGING_RABBITMQ_URL:\s*\$\{\{\s*secrets\.MESSAGING_RABBITMQ_URL\s*\}\}/);
  assert.match(staging, /ensure-vercel-project\.sh/);
  assert.match(staging, /vercel-upsert-sensitive-env\.sh/);
  assert.match(staging, /smoke-database-health\.sh/);
  assert.match(staging, /https:\/\/moventra-tms-staging-alebru\.vercel\.app/);
  assert.match(staging, /VERCEL_PROJECT_ID=%s\\n'\s*"\$value"\s*>>\s*"\$GITHUB_ENV"/);
  assert.doesNotMatch(staging, /vars\.VERCEL_STAGING_PROJECT_ID/);
  assert.doesNotMatch(staging, /https:\/\/moventra-tms-staging\.vercel\.app/);

  assert.match(rollback, /VERCEL_PROJECT_NAME:\s*moventra-tms-staging/);
  assert.match(rollback, /Converge current staging Vercel project/);
  assert.match(rollback, /ensure-vercel-project\.sh/);
  assert.match(rollback, /https:\/\/moventra-tms-staging-alebru\.vercel\.app/);
  assert.doesNotMatch(rollback, /vars\.VERCEL_STAGING_PROJECT_ID/);
  assert.doesNotMatch(rollback, /Resolve current staging Vercel project ID/);
  assert.doesNotMatch(rollback, /https:\/\/moventra-tms-staging\.vercel\.app/);

  assert.match(production, /environment:\s*\n\s*name:\s*production/);
  assert.match(production, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/);
  assert.match(production, /VERCEL_ORG_ID:\s*\$\{\{\s*vars\.VERCEL_ORG_ID\s*\}\}/);
  assert.match(production, /VERCEL_PROJECT_ID:\s*\$\{\{\s*vars\.VERCEL_PRODUCTION_PROJECT_ID\s*\}\}/);
  assert.match(production, /DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/);
  assert.match(production, /MIGRATIONS_DATABASE_URL:\s*\$\{\{\s*secrets\.MIGRATIONS_DATABASE_URL\s*\}\}/);
  assert.match(production, /MESSAGING_RABBITMQ_URL:\s*\$\{\{\s*secrets\.MESSAGING_RABBITMQ_URL\s*\}\}/);
  assert.match(production, /VERCEL_PROJECT_NAME:\s*moventra-tms/);
  assert.match(production, /VERCEL_NODE_VERSION:\s*22\.x/);
  assert.match(production, /Converge production Vercel project/);
  assert.match(production, /ensure-vercel-project\.sh/);
  assert.match(production, /Resolved production Vercel project does not match VERCEL_PRODUCTION_PROJECT_ID/);
  assert.match(production, /Verify production database readiness/);
  assert.match(production, /smoke-database-health\.sh/);
  assert.match(production, /database_readiness=success/);

  for (const workflow of [bootstrap, staging, rollback, production]) {
    assert.doesNotMatch(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*vars\./);
  }
});

test('Vercel project provisioning converges policy and synchronizes staging database credentials without logging values', async () => {
  const ensureProject = await read('scripts/release/ensure-vercel-project.sh');
  const upsertEnv = await read('scripts/release/vercel-upsert-sensitive-env.sh');
  const databaseSmoke = await read('scripts/release/smoke-database-health.sh');

  assert.match(ensureProject, /PATCH/);
  assert.match(ensureProject, /nodeVersion/);
  assert.match(ensureProject, /previewDeploymentsDisabled/);
  assert.match(ensureProject, /resourceConfig:\s*\{\s*fluid:\s*true/);
  assert.match(ensureProject, /inferred_project_url/);
  assert.match(ensureProject, /scope_mode="inferred"/);
  assert.match(ensureProject, /token does not grant access to project/);
  assert.doesNotMatch(ensureProject, /cat\s+[^\n]*project.*\.json/);

  assert.match(upsertEnv, /type:\s*'sensitive'/);
  assert.match(upsertEnv, /upsert=true/);
  assert.match(upsertEnv, /VERCEL_ENV_VALUE/);
  assert.match(upsertEnv, /Never print the API response/);
  assert.match(upsertEnv, /inferred_url/);
  assert.match(upsertEnv, /auth_context="inferred"/);
  assert.doesNotMatch(upsertEnv, /printf[^\n]*VERCEL_ENV_VALUE/);
  assert.doesNotMatch(upsertEnv, /echo[^\n]*VERCEL_ENV_VALUE/);

  assert.match(databaseSmoke, /api\/database-health/);
  assert.match(databaseSmoke, /payload\.status !== "ready"/);
  assert.match(databaseSmoke, /payload\.service !== "database"/);
  assert.match(databaseSmoke, /payload\.version !== process\.env\.EXPECTED_SHA/);
});

test('secrets policy defines segregation, rotation, audit and canonical migration credential', async () => {
  const policy = await read('docs/security/SECRETS-POLICY.md');
  for (const required of [
    'secrets distintos por ambiente',
    'menor privilégio',
    'rotação',
    'auditoria',
    'workload identity/OIDC',
    'fail-closed',
    'DATABASE_URL',
    'MIGRATIONS_DATABASE_URL',
    'VARIABLES-MATRIX.md',
  ]) {
    assert.ok(policy.toLowerCase().includes(required.toLowerCase()), `policy is missing: ${required}`);
  }

  assert.ok(!policy.includes('DATABASE_MIGRATION_URL'));
});

test('master variables matrix covers the governed systems and divergence actions', async () => {
  const matrix = await read('docs/governance/VARIABLES-MATRIX.md');
  for (const required of [
    'Sistema',
    'Ambiente',
    'Variável',
    'Valor/default',
    'Secret',
    'Origem',
    'Consumidor',
    'Status',
    'Divergência',
    'Ação',
    'GitHub',
    'Vercel',
    'Neon',
    'Railway',
    'RabbitMQ',
    'MIGRATIONS_DATABASE_URL',
    'MOVENTRA_RELEASE_SHA',
    'OTEL_SDK_DISABLED',
  ]) {
    assert.ok(matrix.includes(required), `variables matrix is missing: ${required}`);
  }
});
