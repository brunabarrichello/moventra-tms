-- Moventra TMS — PostgreSQL runtime access contract
-- P0 hardening after G2 audit, extended through phase 019 Feature Flags.
-- Apply with psql -v runtime_role=<NOLOGIN authorization role> -f db/runtime/runtime-access.sql
-- The runtime role name is deliberately supplied by the environment; no secret is stored here.

\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'runtime_role psql variable is required'
  \quit 3
\endif

-- Runtime may resolve objects but may never create objects in application schemas.
GRANT USAGE ON SCHEMA organization, identity, security, audit, configuration, feature_flags TO :"runtime_role";
REVOKE CREATE ON SCHEMA organization, identity, security, audit, configuration, feature_flags FROM :"runtime_role";

-- Migration metadata is an administrative boundary and is never visible to runtime.
REVOKE ALL PRIVILEGES ON SCHEMA moventra_meta FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA moventra_meta FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA moventra_meta FROM :"runtime_role";

-- Reset current application-table ACLs first so reruns converge instead of accumulating grants.
REVOKE ALL PRIVILEGES ON
  organization.tenants,
  organization.companies,
  organization.branches,
  identity.users,
  identity.memberships,
  identity.external_identities,
  security.permissions,
  security.roles,
  security.role_permissions,
  security.membership_roles,
  security.organizational_scopes,
  security.role_assignment_scopes,
  audit.audit_events,
  configuration.definitions,
  configuration.settings,
  configuration.setting_versions,
  feature_flags.flags,
  feature_flags.environment_policies,
  feature_flags.rules,
  feature_flags.rule_versions
FROM :"runtime_role";

-- Organization lifecycle repositories use reads plus append/update with optimistic locking.
GRANT SELECT, INSERT, UPDATE ON
  organization.tenants,
  organization.companies,
  organization.branches
TO :"runtime_role";

-- Global identity and tenant memberships are mutable through application workflows.
GRANT SELECT, INSERT, UPDATE ON
  identity.users,
  identity.memberships,
  identity.external_identities
TO :"runtime_role";

-- Platform-owned global catalogs are read-only to normal application runtime.
GRANT SELECT ON security.permissions TO :"runtime_role";
GRANT SELECT ON configuration.definitions TO :"runtime_role";
GRANT SELECT ON feature_flags.flags TO :"runtime_role";
GRANT SELECT ON feature_flags.environment_policies TO :"runtime_role";

-- Tenant-owned authorization/configuration/feature-flag state is mutable but never hard-deleted by runtime.
GRANT SELECT, INSERT, UPDATE ON
  security.roles,
  security.role_permissions,
  security.membership_roles,
  security.organizational_scopes,
  security.role_assignment_scopes,
  configuration.settings,
  feature_flags.rules
TO :"runtime_role";

-- Domain histories are append-only. Runtime may read tenant-scoped history and append new versions.
GRANT SELECT, INSERT ON configuration.setting_versions TO :"runtime_role";
GRANT SELECT, INSERT ON feature_flags.rule_versions TO :"runtime_role";

-- Central audit is append-only. SELECT is column-limited to satisfy INSERT ... RETURNING id, occurred_at.
GRANT INSERT ON audit.audit_events TO :"runtime_role";
GRANT SELECT (id, occurred_at) ON audit.audit_events TO :"runtime_role";

-- RLS tenant resolution is explicit; backend authorization remains mandatory.
GRANT EXECUTE ON FUNCTION security.current_tenant_id() TO :"runtime_role";

-- Explicit negative boundary: runtime performs no hard delete on current domain/security/configuration/feature-flag/audit tables.
REVOKE DELETE ON
  organization.tenants,
  organization.companies,
  organization.branches,
  identity.users,
  identity.memberships,
  identity.external_identities,
  security.permissions,
  security.roles,
  security.role_permissions,
  security.membership_roles,
  security.organizational_scopes,
  security.role_assignment_scopes,
  audit.audit_events,
  configuration.definitions,
  configuration.settings,
  configuration.setting_versions,
  feature_flags.flags,
  feature_flags.environment_policies,
  feature_flags.rules,
  feature_flags.rule_versions
FROM :"runtime_role";

-- Platform-owned catalogs and append-only trails must not be mutated beyond their narrow contract.
REVOKE INSERT, UPDATE ON security.permissions FROM :"runtime_role";
REVOKE INSERT, UPDATE ON configuration.definitions FROM :"runtime_role";
REVOKE INSERT, UPDATE ON feature_flags.flags FROM :"runtime_role";
REVOKE INSERT, UPDATE ON feature_flags.environment_policies FROM :"runtime_role";
REVOKE UPDATE ON configuration.setting_versions FROM :"runtime_role";
REVOKE UPDATE ON feature_flags.rule_versions FROM :"runtime_role";
REVOKE UPDATE ON audit.audit_events FROM :"runtime_role";
