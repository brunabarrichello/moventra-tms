import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 018 materializes global definitions and tenant-scoped settings/history', () => {
  const migration = read('db/migrations/0012_configuration.sql');

  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS configuration/);
  assert.match(migration, /CREATE TABLE configuration\.definitions/);
  assert.match(migration, /CREATE TABLE configuration\.settings/);
  assert.match(migration, /CREATE TABLE configuration\.setting_versions/);
  assert.match(migration, /uq_configuration_settings_active_tenant/);
  assert.match(migration, /uq_configuration_settings_active_company/);
  assert.match(migration, /uq_configuration_settings_active_branch/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, company_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, company_id, branch_id\)/);

  const definitionsBlock = migration.slice(
    migration.indexOf('CREATE TABLE configuration.definitions'),
    migration.indexOf('CREATE TABLE configuration.settings'),
  );
  assert.doesNotMatch(definitionsBlock, /tenant_id/);
});

test('phase 018 keeps secrets outside configuration and uses typed values', () => {
  const migration = read('db/migrations/0012_configuration.sql');
  const domain = read('src/modules/configuration/configuration-domain.js');
  const doc = read('docs/implementation/018-configuracoes.md');

  for (const type of ['BOOLEAN','INTEGER','DECIMAL','STRING','ENUM','JSON','DURATION','TIMEZONE','CURRENCY']) {
    assert.match(migration, new RegExp(type));
  }
  assert.doesNotMatch(migration, /'SECRET'/);
  assert.match(domain, /MVT_CONFIGURATION_SECRET_FORBIDDEN/);
  assert.match(doc, /DATABASE_URL/);
  assert.match(doc, /Secrets Management/);
});

test('configuration history and tenant tables are protected by append-only and RLS controls', () => {
  const migration = read('db/migrations/0012_configuration.sql');
  const runtime = read('db/runtime/runtime-access.sql');

  assert.match(migration, /trg_configuration_setting_versions_append_only/);
  assert.match(migration, /ALTER TABLE configuration\.settings ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE configuration\.setting_versions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_isolation_configuration_settings/);
  assert.match(migration, /tenant_isolation_configuration_setting_versions/);
  assert.match(runtime, /GRANT SELECT ON configuration\.definitions/);
  assert.match(runtime, /configuration\.settings/);
  assert.match(runtime, /configuration\.setting_versions/);
  assert.match(runtime, /REVOKE INSERT, UPDATE ON configuration\.definitions/);
  assert.match(runtime, /REVOKE UPDATE ON configuration\.setting_versions/);
});

test('configuration access reuses the P1 security pipeline and explicit RBAC permissions', () => {
  const migration = read('db/migrations/0012_configuration.sql');
  const service = read('src/modules/configuration/configuration-service.js');

  assert.match(migration, /configuration\.settings\.read/);
  assert.match(migration, /configuration\.settings\.manage/);
  assert.match(service, /AuthorizedTenantOperationService/);
  assert.match(service, /configuration\.settings\.read/);
  assert.match(service, /configuration\.settings\.manage/);
  assert.match(service, /valueIncluded: false/);
  assert.doesNotMatch(service, /audit:[\s\S]{0,500}value:\s*input\.value/);
});

test('resolver precedence is explicitly Branch then Company then Tenant then definition default', () => {
  const repository = read('src/modules/configuration/configuration-repository.js');
  const doc = read('docs/implementation/018-configuracoes.md');

  assert.match(doc, /BRANCH > COMPANY > TENANT > DEFINITION_DEFAULT/);
  assert.match(repository, /buildResolutionCandidates/);
  assert.match(repository, /DEFINITION_DEFAULT/);
  assert.match(repository, /MVT_CONFIGURATION_VALUE_MISSING/);
});
