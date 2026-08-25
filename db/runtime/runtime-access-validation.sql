-- Moventra TMS — runtime access validation
-- Requires psql variables runtime_role and app_role.
\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'runtime_role psql variable is required'
  \quit 3
\endif
\if :{?app_role}
\else
  \echo 'app_role psql variable is required'
  \quit 3
\endif

SELECT set_config('moventra.validation_runtime_role', :'runtime_role', false);

DO $validation$
DECLARE
  runtime_role TEXT := current_setting('moventra.validation_runtime_role');
  schema_name TEXT;
  mutable_table TEXT;
  protected_table TEXT;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['organization','identity','security','audit','configuration','feature_flags'] LOOP
    IF NOT has_schema_privilege(runtime_role, schema_name, 'USAGE') THEN
      RAISE EXCEPTION 'runtime role lacks USAGE on schema %', schema_name;
    END IF;
    IF has_schema_privilege(runtime_role, schema_name, 'CREATE') THEN
      RAISE EXCEPTION 'runtime role must not CREATE in schema %', schema_name;
    END IF;
  END LOOP;

  IF has_schema_privilege(runtime_role, 'moventra_meta', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role must not have USAGE on moventra_meta';
  END IF;

  FOREACH mutable_table IN ARRAY ARRAY[
    'organization.tenants',
    'organization.companies',
    'organization.branches',
    'identity.users',
    'identity.memberships',
    'identity.external_identities',
    'security.roles',
    'security.role_permissions',
    'security.membership_roles',
    'security.organizational_scopes',
    'security.role_assignment_scopes',
    'configuration.settings',
    'feature_flags.rules'
  ] LOOP
    IF NOT has_table_privilege(runtime_role, mutable_table, 'SELECT')
       OR NOT has_table_privilege(runtime_role, mutable_table, 'INSERT')
       OR NOT has_table_privilege(runtime_role, mutable_table, 'UPDATE') THEN
      RAISE EXCEPTION 'runtime role lacks required SELECT/INSERT/UPDATE on %', mutable_table;
    END IF;
    IF has_table_privilege(runtime_role, mutable_table, 'DELETE') THEN
      RAISE EXCEPTION 'runtime role must not DELETE from %', mutable_table;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(runtime_role, 'security.permissions', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role must read global permission catalog';
  END IF;
  IF has_table_privilege(runtime_role, 'security.permissions', 'INSERT')
     OR has_table_privilege(runtime_role, 'security.permissions', 'UPDATE')
     OR has_table_privilege(runtime_role, 'security.permissions', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not mutate global permission catalog';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'configuration.definitions', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role must read global configuration definitions';
  END IF;
  IF has_table_privilege(runtime_role, 'configuration.definitions', 'INSERT')
     OR has_table_privilege(runtime_role, 'configuration.definitions', 'UPDATE')
     OR has_table_privilege(runtime_role, 'configuration.definitions', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not mutate global configuration definitions';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'feature_flags.flags', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'feature_flags.environment_policies', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role must read global feature flag catalogs';
  END IF;
  IF has_table_privilege(runtime_role, 'feature_flags.flags', 'INSERT')
     OR has_table_privilege(runtime_role, 'feature_flags.flags', 'UPDATE')
     OR has_table_privilege(runtime_role, 'feature_flags.flags', 'DELETE')
     OR has_table_privilege(runtime_role, 'feature_flags.environment_policies', 'INSERT')
     OR has_table_privilege(runtime_role, 'feature_flags.environment_policies', 'UPDATE')
     OR has_table_privilege(runtime_role, 'feature_flags.environment_policies', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not mutate global feature flag catalogs';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'configuration.setting_versions', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'configuration.setting_versions', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role must read and append configuration history';
  END IF;
  IF has_table_privilege(runtime_role, 'configuration.setting_versions', 'UPDATE')
     OR has_table_privilege(runtime_role, 'configuration.setting_versions', 'DELETE') THEN
    RAISE EXCEPTION 'configuration history must remain append-only for runtime';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'feature_flags.rule_versions', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'feature_flags.rule_versions', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role must read and append feature flag history';
  END IF;
  IF has_table_privilege(runtime_role, 'feature_flags.rule_versions', 'UPDATE')
     OR has_table_privilege(runtime_role, 'feature_flags.rule_versions', 'DELETE') THEN
    RAISE EXCEPTION 'feature flag history must remain append-only for runtime';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'audit.audit_events', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role must append audit events';
  END IF;
  IF has_table_privilege(runtime_role, 'audit.audit_events', 'SELECT')
     OR has_table_privilege(runtime_role, 'audit.audit_events', 'UPDATE')
     OR has_table_privilege(runtime_role, 'audit.audit_events', 'DELETE') THEN
    RAISE EXCEPTION 'audit table-level SELECT/UPDATE/DELETE must remain denied';
  END IF;
  IF NOT has_column_privilege(runtime_role, 'audit.audit_events', 'id', 'SELECT')
     OR NOT has_column_privilege(runtime_role, 'audit.audit_events', 'occurred_at', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role needs SELECT only on audit RETURNING columns';
  END IF;

  FOREACH protected_table IN ARRAY ARRAY[
    'organization.tenants','organization.companies','organization.branches',
    'identity.memberships','security.roles','security.role_permissions',
    'security.membership_roles','security.organizational_scopes',
    'security.role_assignment_scopes','audit.audit_events',
    'configuration.settings','configuration.setting_versions',
    'feature_flags.rules','feature_flags.rule_versions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = split_part(protected_table,'.',1)
         AND c.relname = split_part(protected_table,'.',2)
         AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled for %', protected_table;
    END IF;
  END LOOP;
END
$validation$;

BEGIN;

-- Global platform-owned catalogs are seeded by the administrative validation principal,
-- never by the runtime application role.
INSERT INTO configuration.definitions (
  id, key, owner_domain, name, value_type, default_value, validation_schema,
  allow_tenant_override, allow_company_override, allow_branch_override,
  sensitivity, status
) VALUES (
  '01990000-0000-7000-8000-000000000200',
  'validation.runtime.enabled',
  'validation',
  'Runtime validation enabled',
  'BOOLEAN',
  'false'::jsonb,
  '{}'::jsonb,
  TRUE, TRUE, TRUE,
  'INTERNAL',
  'ACTIVE'
);

INSERT INTO feature_flags.flags (
  id, key, name, description, default_enabled, status, hash_version
) VALUES (
  '01990000-0000-7000-8000-000000000300',
  'validation.runtime.feature_flag',
  'Runtime validation feature flag',
  'Synthetic platform flag for runtime ACL validation',
  FALSE,
  'ACTIVE',
  1
);

INSERT INTO feature_flags.environment_policies (
  id, flag_id, environment, enabled, rollout_basis_points, status
) VALUES (
  '01990000-0000-7000-8000-000000000301',
  '01990000-0000-7000-8000-000000000300',
  'staging',
  TRUE,
  10000,
  'ACTIVE'
);

SET ROLE :"app_role";

-- Two deterministic tenants are created under their own transaction-local RLS contexts.
SELECT set_config('moventra.tenant_id', '01990000-0000-7000-8000-000000000001', true);
INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES (
  '01990000-0000-7000-8000-000000000001', 'ci-runtime-a', 'CI Runtime A', 'ACTIVE', 'UTC', 'USD'
);

SELECT set_config('moventra.tenant_id', '01990000-0000-7000-8000-000000000002', true);
INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES (
  '01990000-0000-7000-8000-000000000002', 'ci-runtime-b', 'CI Runtime B', 'ACTIVE', 'UTC', 'USD'
);

-- Global identity remains reachable independently of tenant RLS.
INSERT INTO identity.users (
  id, primary_email, display_name, status
) VALUES (
  '01990000-0000-7000-8000-000000000100', 'runtime-contract@example.invalid', 'Runtime Contract User', 'ACTIVE'
);

-- Tenant A can write and read its own membership.
SELECT set_config('moventra.tenant_id', '01990000-0000-7000-8000-000000000001', true);
INSERT INTO identity.memberships (
  id, tenant_id, user_id, status
) VALUES (
  '01990000-0000-7000-8000-000000000101',
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000100',
  'ACTIVE'
);

UPDATE organization.tenants
   SET display_name = 'CI Runtime A Updated', updated_at = now(), version = version + 1
 WHERE id = '01990000-0000-7000-8000-000000000001';

INSERT INTO configuration.settings (
  id, tenant_id, configuration_definition_id, scope_type, value, status
) VALUES (
  '01990000-0000-7000-8000-000000000201',
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000200',
  'TENANT',
  'true'::jsonb,
  'ACTIVE'
);

INSERT INTO configuration.setting_versions (
  tenant_id, setting_id, setting_version, value, status, change_type, reason
) VALUES (
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000201',
  1,
  'true'::jsonb,
  'ACTIVE',
  'CREATE',
  'runtime validation'
);

INSERT INTO feature_flags.rules (
  id, tenant_id, flag_id, environment, target_type, enabled, rollout_basis_points, status
) VALUES (
  '01990000-0000-7000-8000-000000000302',
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000300',
  'staging',
  'TENANT',
  TRUE,
  10000,
  'ACTIVE'
);

INSERT INTO feature_flags.rule_versions (
  tenant_id, rule_id, rule_version, enabled, rollout_basis_points, status, change_type, reason
) VALUES (
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000302',
  1,
  TRUE,
  10000,
  'ACTIVE',
  'CREATE',
  'runtime validation'
);

DO $rls$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM organization.tenants
   WHERE id = '01990000-0000-7000-8000-000000000002';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant Tenant read was not isolated';
  END IF;

  BEGIN
    INSERT INTO identity.memberships (
      id, tenant_id, user_id, status
    ) VALUES (
      '01990000-0000-7000-8000-000000000102',
      '01990000-0000-7000-8000-000000000002',
      '01990000-0000-7000-8000-000000000100',
      'ACTIVE'
    );
    RAISE EXCEPTION 'cross-tenant membership write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT count(*) INTO visible_count
    FROM configuration.settings
   WHERE tenant_id = '01990000-0000-7000-8000-000000000002';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant configuration read was not isolated';
  END IF;

  BEGIN
    INSERT INTO configuration.settings (
      tenant_id, configuration_definition_id, scope_type, value, status
    ) VALUES (
      '01990000-0000-7000-8000-000000000002',
      '01990000-0000-7000-8000-000000000200',
      'TENANT',
      'true'::jsonb,
      'ACTIVE'
    );
    RAISE EXCEPTION 'cross-tenant configuration write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT count(*) INTO visible_count
    FROM feature_flags.rules
   WHERE tenant_id = '01990000-0000-7000-8000-000000000002';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant feature flag read was not isolated';
  END IF;

  BEGIN
    INSERT INTO feature_flags.rules (
      tenant_id, flag_id, environment, target_type, enabled, rollout_basis_points, status
    ) VALUES (
      '01990000-0000-7000-8000-000000000002',
      '01990000-0000-7000-8000-000000000300',
      'staging',
      'TENANT',
      TRUE,
      10000,
      'ACTIVE'
    );
    RAISE EXCEPTION 'cross-tenant feature flag write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$rls$;

-- Audit append succeeds and RETURNING uses only the two allowed columns.
INSERT INTO audit.audit_events (
  tenant_id, actor_user_id, actor_membership_id,
  category, action, entity_type, entity_id, outcome
) VALUES (
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000100',
  '01990000-0000-7000-8000-000000000101',
  'security', 'validate', 'runtime_contract', 'ci', 'SUCCESS'
) RETURNING id, occurred_at;

DO $negative$
BEGIN
  BEGIN
    INSERT INTO security.permissions (code, description, status)
    VALUES ('ci.forbidden', 'must be denied', 'ACTIVE');
    RAISE EXCEPTION 'permission catalog mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO configuration.definitions (
      key, owner_domain, name, value_type, allow_tenant_override, sensitivity, status
    ) VALUES (
      'forbidden.runtime.definition', 'validation', 'Forbidden definition', 'BOOLEAN', TRUE, 'INTERNAL', 'ACTIVE'
    );
    RAISE EXCEPTION 'configuration definition mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO feature_flags.flags (key, name, default_enabled, status, hash_version)
    VALUES ('forbidden.runtime.flag', 'Forbidden runtime flag', FALSE, 'ACTIVE', 1);
    RAISE EXCEPTION 'feature flag catalog mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE feature_flags.environment_policies SET enabled = FALSE;
    RAISE EXCEPTION 'feature flag environment policy mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE configuration.setting_versions SET reason = 'forbidden';
    RAISE EXCEPTION 'configuration history UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM configuration.setting_versions;
    RAISE EXCEPTION 'configuration history DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE feature_flags.rule_versions SET reason = 'forbidden';
    RAISE EXCEPTION 'feature flag history UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM feature_flags.rule_versions;
    RAISE EXCEPTION 'feature flag history DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE audit.audit_events SET reason = 'forbidden';
    RAISE EXCEPTION 'audit UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM audit.audit_events;
    RAISE EXCEPTION 'audit DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM count(*) FROM moventra_meta.schema_migrations;
    RAISE EXCEPTION 'runtime unexpectedly read migration metadata';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'CREATE TABLE feature_flags.runtime_forbidden(id integer)';
    RAISE EXCEPTION 'runtime unexpectedly created a table';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$negative$;

ROLLBACK;
RESET ROLE;
