-- Moventra TMS — Runtime PostgreSQL privilege contract validation
-- P0 hardening after G2. This is a CI-only contract test and not a schema migration.

DO $precondition$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moventra_runtime_ci_contract') THEN
    RAISE EXCEPTION 'CI runtime contract role must not pre-exist';
  END IF;
END
$precondition$;

CREATE ROLE moventra_runtime_ci_contract
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

GRANT USAGE ON SCHEMA organization, identity, security, audit TO moventra_runtime_ci_contract;
GRANT SELECT, INSERT, UPDATE ON TABLE organization.tenants, organization.companies, organization.branches TO moventra_runtime_ci_contract;
GRANT SELECT, INSERT, UPDATE ON TABLE identity.users, identity.memberships, identity.external_identities TO moventra_runtime_ci_contract;
GRANT SELECT ON TABLE security.permissions TO moventra_runtime_ci_contract;
GRANT SELECT, INSERT, UPDATE ON TABLE security.roles, security.membership_roles, security.organizational_scopes TO moventra_runtime_ci_contract;
GRANT SELECT, INSERT, DELETE ON TABLE security.role_permissions, security.role_assignment_scopes TO moventra_runtime_ci_contract;
GRANT SELECT, INSERT ON TABLE audit.audit_events TO moventra_runtime_ci_contract;
GRANT EXECUTE ON FUNCTION security.current_tenant_id() TO moventra_runtime_ci_contract;

DO $validation$
DECLARE
  role_name CONSTANT TEXT := 'moventra_runtime_ci_contract';
  object_name TEXT;
BEGIN
  FOREACH object_name IN ARRAY ARRAY['organization', 'identity', 'security', 'audit'] LOOP
    IF NOT has_schema_privilege(role_name, object_name, 'USAGE') THEN
      RAISE EXCEPTION 'runtime role lacks USAGE on schema %', object_name;
    END IF;
  END LOOP;

  FOREACH object_name IN ARRAY ARRAY[
    'organization.tenants', 'organization.companies', 'organization.branches',
    'identity.users', 'identity.memberships', 'identity.external_identities',
    'security.roles', 'security.membership_roles', 'security.organizational_scopes'
  ] LOOP
    IF NOT has_table_privilege(role_name, object_name, 'SELECT')
       OR NOT has_table_privilege(role_name, object_name, 'INSERT')
       OR NOT has_table_privilege(role_name, object_name, 'UPDATE') THEN
      RAISE EXCEPTION 'runtime role lacks lifecycle privileges on %', object_name;
    END IF;
    IF has_table_privilege(role_name, object_name, 'DELETE') THEN
      RAISE EXCEPTION 'runtime role must not DELETE lifecycle table %', object_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(role_name, 'security.permissions', 'SELECT')
     OR has_table_privilege(role_name, 'security.permissions', 'INSERT')
     OR has_table_privilege(role_name, 'security.permissions', 'UPDATE')
     OR has_table_privilege(role_name, 'security.permissions', 'DELETE') THEN
    RAISE EXCEPTION 'permission catalog must be SELECT-only for runtime';
  END IF;

  FOREACH object_name IN ARRAY ARRAY['security.role_permissions', 'security.role_assignment_scopes'] LOOP
    IF NOT has_table_privilege(role_name, object_name, 'SELECT')
       OR NOT has_table_privilege(role_name, object_name, 'INSERT')
       OR NOT has_table_privilege(role_name, object_name, 'DELETE') THEN
      RAISE EXCEPTION 'runtime role lacks junction privileges on %', object_name;
    END IF;
    IF has_table_privilege(role_name, object_name, 'UPDATE') THEN
      RAISE EXCEPTION 'runtime role must not UPDATE immutable junction %', object_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(role_name, 'audit.audit_events', 'SELECT')
     OR NOT has_table_privilege(role_name, 'audit.audit_events', 'INSERT')
     OR has_table_privilege(role_name, 'audit.audit_events', 'UPDATE')
     OR has_table_privilege(role_name, 'audit.audit_events', 'DELETE') THEN
    RAISE EXCEPTION 'audit runtime privilege contract is invalid';
  END IF;

  IF NOT has_function_privilege(role_name, 'security.current_tenant_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime role cannot execute security.current_tenant_id()';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = role_name
       AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'runtime role received forbidden role attributes';
  END IF;
END
$validation$;

REVOKE EXECUTE ON FUNCTION security.current_tenant_id() FROM moventra_runtime_ci_contract;
REVOKE SELECT, INSERT ON TABLE audit.audit_events FROM moventra_runtime_ci_contract;
REVOKE SELECT, INSERT, DELETE ON TABLE security.role_permissions, security.role_assignment_scopes FROM moventra_runtime_ci_contract;
REVOKE SELECT, INSERT, UPDATE ON TABLE security.roles, security.membership_roles, security.organizational_scopes FROM moventra_runtime_ci_contract;
REVOKE SELECT ON TABLE security.permissions FROM moventra_runtime_ci_contract;
REVOKE SELECT, INSERT, UPDATE ON TABLE identity.users, identity.memberships, identity.external_identities FROM moventra_runtime_ci_contract;
REVOKE SELECT, INSERT, UPDATE ON TABLE organization.tenants, organization.companies, organization.branches FROM moventra_runtime_ci_contract;
REVOKE USAGE ON SCHEMA organization, identity, security, audit FROM moventra_runtime_ci_contract;
DROP ROLE moventra_runtime_ci_contract;
