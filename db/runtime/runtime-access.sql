-- Moventra TMS — PostgreSQL application runtime access contract
-- P0 hardening after G2 audit, extended through phase 026 DLQ.
-- Apply with psql -v runtime_role=<NOLOGIN authorization role> -f db/runtime/runtime-access.sql
-- Worker-only cross-tenant/system capabilities live in db/runtime/worker-access.sql.

\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'runtime_role psql variable is required'
  \quit 3
\endif

-- Application runtime may resolve objects but may never create objects in application schemas.
GRANT USAGE ON SCHEMA organization, identity, security, audit, configuration, feature_flags, idempotency, outbox, jobs, dlq TO :"runtime_role";
REVOKE CREATE ON SCHEMA organization, identity, security, audit, configuration, feature_flags, idempotency, outbox, jobs, dlq FROM :"runtime_role";

REVOKE ALL PRIVILEGES ON SCHEMA moventra_meta FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA moventra_meta FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA moventra_meta FROM :"runtime_role";

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
  feature_flags.rule_versions,
  idempotency.records,
  outbox.events,
  jobs.jobs,
  jobs.system_jobs,
  dlq.entries,
  dlq.system_entries
FROM :"runtime_role";

-- Converge worker-only function grants away from the HTTP/application principal.
REVOKE EXECUTE ON FUNCTION outbox.claim_system_batch(INTEGER, BIGINT, UUID) FROM :"runtime_role";
REVOKE EXECUTE ON FUNCTION outbox.mark_system_published(UUID, UUID) FROM :"runtime_role";

GRANT SELECT, INSERT, UPDATE ON
  organization.tenants,
  organization.companies,
  organization.branches
TO :"runtime_role";

GRANT SELECT, INSERT, UPDATE ON
  identity.users,
  identity.memberships,
  identity.external_identities
TO :"runtime_role";

GRANT SELECT ON security.permissions TO :"runtime_role";
GRANT SELECT ON configuration.definitions TO :"runtime_role";
GRANT SELECT ON feature_flags.flags TO :"runtime_role";
GRANT SELECT ON feature_flags.environment_policies TO :"runtime_role";

GRANT SELECT, INSERT, UPDATE ON
  security.roles,
  security.role_permissions,
  security.membership_roles,
  security.organizational_scopes,
  security.role_assignment_scopes,
  configuration.settings,
  feature_flags.rules,
  idempotency.records
TO :"runtime_role";

-- Application runtime may append/read tenant-scoped Outbox events, but it does not
-- receive the cross-tenant dispatcher capability owned by the dedicated worker role.
GRANT SELECT, INSERT ON outbox.events TO :"runtime_role";
GRANT UPDATE (attempt_count, last_attempt_at, claim_token, claimed_at, published_at)
  ON outbox.events TO :"runtime_role";

-- Authorized tenant workflows may schedule and inspect their own jobs through RLS.
-- Lifecycle mutation remains column-scoped; immutable ownership/contract fields are protected.
GRANT SELECT, INSERT ON jobs.jobs TO :"runtime_role";
GRANT UPDATE (
  status,
  available_at,
  attempt_count,
  lease_token,
  leased_at,
  lease_expires_at,
  last_heartbeat_at,
  last_error_code,
  last_error_class,
  last_completed_at,
  completed_at,
  cancelled_at,
  updated_at
) ON jobs.jobs TO :"runtime_role";

-- System schedules are invisible and non-mutable to the normal application runtime.
REVOKE ALL PRIVILEGES ON jobs.system_jobs FROM :"runtime_role";

-- DLQ administrative surfaces use the normal tenant runtime under RLS, but cannot create
-- or rewrite quarantined payloads/source identity. Only lifecycle fields required by
-- governed reprocessing/resolution are mutable. System DLQ entries remain invisible.
GRANT SELECT ON dlq.entries TO :"runtime_role";
GRANT UPDATE (
  status,
  reprocess_count,
  next_reprocess_at,
  reprocess_claim_token,
  reprocess_claimed_at,
  reprocess_claim_expires_at,
  last_reprocess_at,
  last_failure_code,
  resolved_at,
  resolved_by_membership_id,
  resolution_code,
  version,
  updated_at
) ON dlq.entries TO :"runtime_role";
REVOKE INSERT, DELETE ON dlq.entries FROM :"runtime_role";
REVOKE UPDATE (
  tenant_id,
  source_kind,
  source_id,
  source_type,
  source_schema_version,
  failure_code,
  failure_class,
  snapshot,
  metadata,
  quarantined_at,
  max_reprocess_attempts,
  created_at
) ON dlq.entries FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON dlq.system_entries FROM :"runtime_role";

GRANT SELECT, INSERT ON configuration.setting_versions TO :"runtime_role";
GRANT SELECT, INSERT ON feature_flags.rule_versions TO :"runtime_role";

GRANT INSERT ON audit.audit_events TO :"runtime_role";
GRANT SELECT (id, occurred_at) ON audit.audit_events TO :"runtime_role";

GRANT EXECUTE ON FUNCTION security.current_tenant_id() TO :"runtime_role";

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
  feature_flags.rule_versions,
  idempotency.records,
  outbox.events,
  jobs.jobs,
  jobs.system_jobs,
  dlq.entries,
  dlq.system_entries
FROM :"runtime_role";

REVOKE INSERT, UPDATE ON security.permissions FROM :"runtime_role";
REVOKE INSERT, UPDATE ON configuration.definitions FROM :"runtime_role";
REVOKE INSERT, UPDATE ON feature_flags.flags FROM :"runtime_role";
REVOKE INSERT, UPDATE ON feature_flags.environment_policies FROM :"runtime_role";
REVOKE UPDATE ON configuration.setting_versions FROM :"runtime_role";
REVOKE UPDATE ON feature_flags.rule_versions FROM :"runtime_role";
REVOKE UPDATE ON audit.audit_events FROM :"runtime_role";
