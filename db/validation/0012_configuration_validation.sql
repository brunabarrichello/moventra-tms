-- Moventra TMS — Validation 0012: Configuration
-- Phase 018 — Configurações
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  policy_count INTEGER;
BEGIN
  IF to_regclass('configuration.definitions') IS NULL
     OR to_regclass('configuration.settings') IS NULL
     OR to_regclass('configuration.setting_versions') IS NULL THEN
    RAISE EXCEPTION 'configuration tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'configuration'
       AND table_name = 'definitions'
       AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'configuration.definitions must remain global';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'configuration' AND c.relname = 'settings' AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'configuration' AND c.relname = 'setting_versions' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'tenant-scoped configuration tables must have RLS enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'configuration' AND c.relname = 'definitions' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'global configuration.definitions must not have tenant RLS';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'configuration'
     AND policyname IN (
       'tenant_isolation_configuration_settings',
       'tenant_isolation_configuration_setting_versions'
     );
  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'configuration tenant isolation policies are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'configuration'
      AND c.relname = 'setting_versions'
      AND t.tgname = 'trg_configuration_setting_versions_append_only'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'setting_versions append-only trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'configuration'
       AND indexname = 'uq_configuration_settings_active_tenant'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'configuration'
       AND indexname = 'uq_configuration_settings_active_company'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'configuration'
       AND indexname = 'uq_configuration_settings_active_branch'
  ) THEN
    RAISE EXCEPTION 'active scope uniqueness indexes are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM security.permissions
     WHERE code = 'configuration.settings.read' AND status = 'ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM security.permissions
     WHERE code = 'configuration.settings.manage' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'configuration RBAC permissions are missing or inactive';
  END IF;
END
$validation$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990180-0000-7000-8000-000000000001', 'configuration-ci-a', 'Configuration CI A', 'ACTIVE', 'UTC', 'USD'),
  ('01990180-0000-7000-8000-000000000002', 'configuration-ci-b', 'Configuration CI B', 'ACTIVE', 'UTC', 'USD');

INSERT INTO organization.companies (
  id, tenant_id, code, legal_name, registration_country, status
) VALUES
  ('01990180-0000-7000-8000-000000000011', '01990180-0000-7000-8000-000000000001', 'cfg-company-a', 'Configuration Company A', 'BR', 'ACTIVE'),
  ('01990180-0000-7000-8000-000000000012', '01990180-0000-7000-8000-000000000002', 'cfg-company-b', 'Configuration Company B', 'BR', 'ACTIVE');

INSERT INTO organization.branches (
  id, tenant_id, company_id, code, display_name, status
) VALUES
  ('01990180-0000-7000-8000-000000000021', '01990180-0000-7000-8000-000000000001', '01990180-0000-7000-8000-000000000011', 'cfg-branch-a', 'Configuration Branch A', 'ACTIVE'),
  ('01990180-0000-7000-8000-000000000022', '01990180-0000-7000-8000-000000000002', '01990180-0000-7000-8000-000000000012', 'cfg-branch-b', 'Configuration Branch B', 'ACTIVE');

INSERT INTO configuration.definitions (
  id, key, owner_domain, name, value_type, default_value, validation_schema,
  allow_tenant_override, allow_company_override, allow_branch_override,
  sensitivity, status
) VALUES (
  '01990180-0000-7000-8000-000000000100',
  'validation.configuration.enabled',
  'validation',
  'Validation configuration enabled',
  'BOOLEAN',
  'false'::jsonb,
  '{}'::jsonb,
  TRUE, TRUE, TRUE,
  'INTERNAL',
  'ACTIVE'
);

INSERT INTO configuration.settings (
  id, tenant_id, configuration_definition_id, scope_type, value, status
) VALUES (
  '01990180-0000-7000-8000-000000000101',
  '01990180-0000-7000-8000-000000000001',
  '01990180-0000-7000-8000-000000000100',
  'TENANT',
  'true'::jsonb,
  'ACTIVE'
);

INSERT INTO configuration.settings (
  id, tenant_id, configuration_definition_id, scope_type, company_id, branch_id, value, status
) VALUES (
  '01990180-0000-7000-8000-000000000102',
  '01990180-0000-7000-8000-000000000001',
  '01990180-0000-7000-8000-000000000100',
  'BRANCH',
  '01990180-0000-7000-8000-000000000011',
  '01990180-0000-7000-8000-000000000021',
  'false'::jsonb,
  'ACTIVE'
);

INSERT INTO configuration.setting_versions (
  tenant_id, setting_id, setting_version, value, status, change_type, reason
) VALUES
  ('01990180-0000-7000-8000-000000000001', '01990180-0000-7000-8000-000000000101', 1, 'true'::jsonb, 'ACTIVE', 'CREATE', 'validation create'),
  ('01990180-0000-7000-8000-000000000001', '01990180-0000-7000-8000-000000000102', 1, 'false'::jsonb, 'ACTIVE', 'CREATE', 'validation create');

DO $append_only$
BEGIN
  BEGIN
    UPDATE configuration.setting_versions
       SET reason = 'forbidden update'
     WHERE setting_id = '01990180-0000-7000-8000-000000000101';
    RAISE EXCEPTION 'setting_versions UPDATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    DELETE FROM configuration.setting_versions
     WHERE setting_id = '01990180-0000-7000-8000-000000000101';
    RAISE EXCEPTION 'setting_versions DELETE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$append_only$;

DO $scope_fk$
BEGIN
  BEGIN
    INSERT INTO configuration.settings (
      tenant_id, configuration_definition_id, scope_type, company_id, value, status
    ) VALUES (
      '01990180-0000-7000-8000-000000000001',
      '01990180-0000-7000-8000-000000000100',
      'COMPANY',
      '01990180-0000-7000-8000-000000000012',
      'true'::jsonb,
      'ACTIVE'
    );
    RAISE EXCEPTION 'cross-tenant Company FK unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$scope_fk$;

ROLLBACK;
