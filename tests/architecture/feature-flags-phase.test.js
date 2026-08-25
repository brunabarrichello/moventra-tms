import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 019 materializes global flag catalogs and tenant-scoped rules/history', () => {
  const migration = read('db/migrations/0013_feature_flags.sql');

  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS feature_flags/);
  assert.match(migration, /CREATE TABLE feature_flags\.flags/);
  assert.match(migration, /CREATE TABLE feature_flags\.environment_policies/);
  assert.match(migration, /CREATE TABLE feature_flags\.rules/);
  assert.match(migration, /CREATE TABLE feature_flags\.rule_versions/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, company_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, company_id, branch_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, user_id\)/);

  const globalCatalogBlock = migration.slice(
    migration.indexOf('CREATE TABLE feature_flags.flags'),
    migration.indexOf('CREATE TABLE feature_flags.rules'),
  );
  assert.doesNotMatch(globalCatalogBlock, /tenant_id/);
});

test('phase 019 target shapes, uniqueness, RLS and append-only history are database-enforced', () => {
  const migration = read('db/migrations/0013_feature_flags.sql');

  for (const target of ['TENANT','COMPANY','BRANCH','USER','PLAN']) {
    assert.match(migration, new RegExp(`'${target}'`));
  }
  for (const index of [
    'uq_feature_flags_rules_active_tenant',
    'uq_feature_flags_rules_active_company',
    'uq_feature_flags_rules_active_branch',
    'uq_feature_flags_rules_active_user',
    'uq_feature_flags_rules_active_plan',
  ]) {
    assert.match(migration, new RegExp(index));
  }
  assert.match(migration, /trg_feature_flags_rule_versions_append_only/);
  assert.match(migration, /ALTER TABLE feature_flags\.rules ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE feature_flags\.rule_versions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_isolation_feature_flags_rules/);
  assert.match(migration, /tenant_isolation_feature_flags_rule_versions/);
});

test('runtime remains least privilege for global catalogs, tenant rules and history', () => {
  const runtime = read('db/runtime/runtime-access.sql');

  assert.match(runtime, /USAGE ON SCHEMA[\s\S]*feature_flags/);
  assert.match(runtime, /REVOKE CREATE ON SCHEMA[\s\S]*feature_flags/);
  assert.match(runtime, /GRANT SELECT ON feature_flags\.flags/);
  assert.match(runtime, /GRANT SELECT ON feature_flags\.environment_policies/);
  assert.match(runtime, /feature_flags\.rules/);
  assert.match(runtime, /GRANT SELECT, INSERT ON feature_flags\.rule_versions/);
  assert.match(runtime, /REVOKE INSERT, UPDATE ON feature_flags\.flags/);
  assert.match(runtime, /REVOKE INSERT, UPDATE ON feature_flags\.environment_policies/);
  assert.match(runtime, /REVOKE UPDATE ON feature_flags\.rule_versions/);
});

test('feature flag rollout is deterministic/versioned and evaluation does not become authorization', () => {
  const domain = read('src/modules/feature-flags/feature-flag-domain.js');
  const service = read('src/modules/feature-flags/feature-flag-service.js');
  const doc = read('docs/implementation/019-feature-flags.md');

  assert.match(domain, /createHash\('sha256'\)/);
  assert.match(domain, /readBigUInt64BE\(0\)/);
  assert.match(domain, /10000n/);
  assert.match(domain, /MVT_FEATURE_FLAG_HASH_VERSION_UNSUPPORTED/);
  assert.match(service, /evaluateAuthorizedContext/);
  assert.match(service, /already-authorized operation context/);
  assert.match(service, /feature_flags\.rules\.manage/);
  assert.doesNotMatch(service, /permission: 'feature_flags\.rules\.read'[\s\S]{0,500}evaluateAuthorizedContext/);
  assert.match(doc, /nunca substitui autenticação, RBAC, Organizational Scope, RLS ou regra de negócio/);
});

test('evaluation precedence is explicit USER then BRANCH then COMPANY then TENANT then PLAN then environment then default', () => {
  const repository = read('src/modules/feature-flags/feature-flag-repository.js');
  const doc = read('docs/implementation/019-feature-flags.md');

  assert.match(doc, /USER > BRANCH > COMPANY > TENANT > PLAN/);
  assert.match(repository, /buildEvaluationCandidates/);
  assert.match(repository, /ENVIRONMENT_POLICY/);
  assert.match(repository, /FLAG_DEFAULT/);
  assert.match(repository, /targetType === FEATURE_FLAG_TARGET\.USER/);
});
