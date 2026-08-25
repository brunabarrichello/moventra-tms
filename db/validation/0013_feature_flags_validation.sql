-- Moventra TMS — Validation 0013: Feature Flags
-- Phase 019 — Feature Flags
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  policy_count INTEGER;
BEGIN
  IF to_regclass('feature_flags.flags') IS NULL
     OR to_regclass('feature_flags.environment_policies') IS NULL
     OR to_regclass('feature_flags.rules') IS NULL
     OR to_regclass('feature_flags.rule_versions') IS NULL THEN
    RAISE EXCEPTION 'feature flag tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'feature_flags'
       AND table_name IN ('flags','environment_policies')
       AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'global feature flag catalogs must not be tenant-owned';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'feature_flags' AND c.relname = 'rules' AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'feature_flags' AND c.relname = 'rule_versions' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'tenant-scoped feature flag tables must have RLS enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'feature_flags'
       AND c.relname IN ('flags','environment_policies')
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'global feature flag catalogs must not have tenant RLS';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'feature_flags'
     AND policyname IN (
       'tenant_isolation_feature_flags_rules',
       'tenant_isolation_feature_flags_rule_versions'
     );
  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'feature flag tenant isolation policies are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'feature_flags'
      AND c.relname = 'rule_versions'
      AND t.tgname = 'trg_feature_flags_rule_versions_append_only'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'feature flag rule history append-only trigger is missing';
  END IF;

  IF (SELECT count(*) FROM pg_indexes
       WHERE schemaname = 'feature_flags'
         AND indexname IN (
           'uq_feature_flags_rules_active_tenant',
           'uq_feature_flags_rules_active_company',
           'uq_feature_flags_rules_active_branch',
           'uq_feature_flags_rules_active_user',
           'uq_feature_flags_rules_active_plan'
         )) <> 5 THEN
    RAISE EXCEPTION 'feature flag active targeting uniqueness indexes are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM security.permissions
     WHERE code = 'feature_flags.rules.read' AND status = 'ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM security.permissions
     WHERE code = 'feature_flags.rules.manage' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'feature flag RBAC permissions are missing or inactive';
  END IF;
END
$validation$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990190-0000-7000-8000-000000000001', 'feature-flags-ci-a', 'Feature Flags CI A', 'ACTIVE', 'UTC', 'USD'),
  ('01990190-0000-7000-8000-000000000002', 'feature-flags-ci-b', 'Feature Flags CI B', 'ACTIVE', 'UTC', 'USD');

INSERT INTO organization.companies (
  id, tenant_id, code, legal_name, registration_country, status
) VALUES
  ('01990190-0000-7000-8000-000000000011', '01990190-0000-7000-8000-000000000001', 'ff-company-a', 'Feature Flags Company A', 'BR', 'ACTIVE'),
  ('01990190-0000-7000-8000-000000000012', '01990190-0000-7000-8000-000000000002', 'ff-company-b', 'Feature Flags Company B', 'BR', 'ACTIVE');

INSERT INTO organization.branches (
  id, tenant_id, company_id, code, display_name, status
) VALUES
  ('01990190-0000-7000-8000-000000000021', '01990190-0000-7000-8000-000000000001', '01990190-0000-7000-8000-000000000011', 'ff-branch-a', 'Feature Flags Branch A', 'ACTIVE'),
  ('01990190-0000-7000-8000-000000000022', '01990190-0000-7000-8000-000000000002', '01990190-0000-7000-8000-000000000012', 'ff-branch-b', 'Feature Flags Branch B', 'ACTIVE');

INSERT INTO identity.users (id, primary_email, display_name, status)
VALUES ('01990190-0000-7000-8000-000000000031', 'feature-flags-ci@example.invalid', 'Feature Flags CI User', 'ACTIVE');

INSERT INTO identity.memberships (id, tenant_id, user_id, status)
VALUES ('01990190-0000-7000-8000-000000000041', '01990190-0000-7000-8000-000000000001', '01990190-0000-7000-8000-000000000031', 'ACTIVE');

INSERT INTO feature_flags.flags (
  id, key, name, description, default_enabled, status, hash_version
) VALUES (
  '01990190-0000-7000-8000-000000000100',
  'validation.feature_flags.enabled',
  'Validation feature flag',
  'Synthetic flag used only by transactional database validation',
  FALSE,
  'ACTIVE',
  1
);

INSERT INTO feature_flags.environment_policies (
  id, flag_id, environment, enabled, rollout_basis_points, status
) VALUES (
  '01990190-0000-7000-8000-000000000101',
  '01990190-0000-7000-8000-000000000100',
  'staging', TRUE, 5000, 'ACTIVE'
);

INSERT INTO feature_flags.rules (
  id, tenant_id, flag_id, environment, target_type, enabled, rollout_basis_points, status
) VALUES (
  '01990190-0000-7000-8000-000000000102',
  '01990190-0000-7000-8000-000000000001',
  '01990190-0000-7000-8000-000000000100',
  'staging', 'TENANT', TRUE, 10000, 'ACTIVE'
);

INSERT INTO feature_flags.rules (
  id, tenant_id, flag_id, environment, target_type, company_id, branch_id,
  enabled, rollout_basis_points, status
) VALUES (
  '01990190-0000-7000-8000-000000000103',
  '01990190-0000-7000-8000-000000000001',
  '01990190-0000-7000-8000-000000000100',
  'staging', 'BRANCH',
  '01990190-0000-7000-8000-000000000011',
  '01990190-0000-7000-8000-000000000021',
  FALSE, 10000, 'ACTIVE'
);

INSERT INTO feature_flags.rules (
  id, tenant_id, flag_id, environment, target_type, user_id,
  enabled, rollout_basis_points, status
) VALUES (
  '01990190-0000-7000-8000-000000000104',
  '01990190-0000-7000-8000-000000000001',
  '01990190-0000-7000-8000-000000000100',
  NULL, 'USER',
  '01990190-0000-7000-8000-000000000031',
  TRUE, 2500, 'ACTIVE'
);

INSERT INTO feature_flags.rules (
  id, tenant_id, flag_id, environment, target_type, plan_key,
  enabled, rollout_basis_points, status
) VALUES (
  '01990190-0000-7000-8000-000000000105',
  '01990190-0000-7000-8000-000000000001',
  '01990190-0000-7000-8000-000000000100',
  'staging', 'PLAN', 'enterprise', TRUE, 7500, 'ACTIVE'
);

INSERT INTO feature_flags.rule_versions (
  tenant_id, rule_id, rule_version, enabled, rollout_basis_points, status, change_type, reason
) VALUES
  ('01990190-0000-7000-8000-000000000001', '01990190-0000-7000-8000-000000000102', 1, TRUE, 10000, 'ACTIVE', 'CREATE', 'validation tenant rule'),
  ('01990190-0000-7000-8000-000000000001', '01990190-0000-7000-8000-000000000103', 1, FALSE, 10000, 'ACTIVE', 'CREATE', 'validation branch rule'),
  ('01990190-0000-7000-8000-000000000001', '01990190-0000-7000-8000-000000000104', 1, TRUE, 2500, 'ACTIVE', 'CREATE', 'validation user rule'),
  ('01990190-0000-7000-8000-000000000001', '01990190-0000-7000-8000-000000000105', 1, TRUE, 7500, 'ACTIVE', 'CREATE', 'validation plan rule');

DO $append_only$
BEGIN
  BEGIN
    UPDATE feature_flags.rule_versions
       SET reason = 'forbidden update'
     WHERE rule_id = '01990190-0000-7000-8000-000000000102';
    RAISE EXCEPTION 'feature flag rule history UPDATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    DELETE FROM feature_flags.rule_versions
     WHERE rule_id = '01990190-0000-7000-8000-000000000102';
    RAISE EXCEPTION 'feature flag rule history DELETE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$append_only$;

DO $cross_tenant_fk$
BEGIN
  BEGIN
    INSERT INTO feature_flags.rules (
      tenant_id, flag_id, environment, target_type, company_id, enabled, rollout_basis_points, status
    ) VALUES (
      '01990190-0000-7000-8000-000000000001',
      '01990190-0000-7000-8000-000000000100',
      'staging', 'COMPANY',
      '01990190-0000-7000-8000-000000000012',
      TRUE, 10000, 'ACTIVE'
    );
    RAISE EXCEPTION 'cross-tenant Company FK unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$cross_tenant_fk$;

DO $duplicate_target$
BEGIN
  BEGIN
    INSERT INTO feature_flags.rules (
      tenant_id, flag_id, environment, target_type, enabled, rollout_basis_points, status
    ) VALUES (
      '01990190-0000-7000-8000-000000000001',
      '01990190-0000-7000-8000-000000000100',
      'staging', 'TENANT', FALSE, 10000, 'ACTIVE'
    );
    RAISE EXCEPTION 'duplicate active targeting rule unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$duplicate_target$;

ROLLBACK;
