-- Moventra TMS — Staging release-smoke PostgreSQL access contract
-- Dedicated control-plane principal for destructive E2E fixtures in the fixed
-- staging tenant only. This principal is NOT a runtime, worker or migration role.
--
-- Apply with an already-created dedicated LOGIN role:
--   psql -v release_smoke_role=<role> -v tenant_id=<uuid> -f db/runtime/release-smoke-access.sql
--
-- RELEASE_SMOKE_DATABASE_URL must connect as that dedicated role and establish the
-- session tenant context for the same tenant_id, while using sslmode=verify-full.

\set ON_ERROR_STOP on
\if :{?release_smoke_role}
\else
  \echo 'release_smoke_role psql variable is required'
  \quit 3
\endif
\if :{?tenant_id}
\else
  \echo 'tenant_id psql variable is required'
  \quit 4
\endif

BEGIN;

-- psql does not substitute variables inside dollar-quoted PL/pgSQL bodies. Carry the
-- operator-supplied UUID through a transaction-local setting, then consume it safely
-- from the guarded block below.
SELECT set_config('moventra.bootstrap_tenant_id', :'tenant_id', true);

-- The reusable fixture tenant is explicit infrastructure state, not product seed data.
DO $fixture_tenant_guard$
DECLARE
  expected_id UUID := current_setting('moventra.bootstrap_tenant_id')::uuid;
  existing_id UUID;
BEGIN
  SELECT id INTO existing_id
    FROM organization.tenants
   WHERE code = 'staging-dlq-smoke';

  IF existing_id IS NOT NULL AND existing_id <> expected_id THEN
    RAISE EXCEPTION 'staging-dlq-smoke tenant already exists with a different id';
  END IF;

  IF existing_id IS NULL THEN
    INSERT INTO organization.tenants (
      id, code, display_name, status, default_timezone, default_currency
    ) VALUES (
      expected_id,
      'staging-dlq-smoke',
      'Staging DLQ Smoke',
      'ACTIVE',
      'UTC',
      'USD'
    );
  END IF;
END
$fixture_tenant_guard$;

-- No DDL authority in application schemas.
GRANT USAGE ON SCHEMA organization, identity, security, audit, idempotency, outbox, dlq
TO :"release_smoke_role";
REVOKE CREATE ON SCHEMA organization, identity, security, audit, idempotency, outbox, dlq
FROM :"release_smoke_role";

-- Explicitly keep unrelated/control-plane schemas outside this principal.
REVOKE ALL PRIVILEGES ON SCHEMA moventra_meta, configuration, feature_flags, jobs
FROM :"release_smoke_role";

-- Reusable tenant and identity fixture.
GRANT SELECT, INSERT, UPDATE ON organization.tenants TO :"release_smoke_role";
GRANT SELECT, INSERT, UPDATE ON identity.users TO :"release_smoke_role";
GRANT SELECT, INSERT, UPDATE ON identity.memberships TO :"release_smoke_role";
GRANT SELECT, INSERT, DELETE ON identity.external_identities TO :"release_smoke_role";

-- RBAC fixture. Permission catalog is read-only.
GRANT SELECT ON security.permissions TO :"release_smoke_role";
GRANT SELECT, INSERT, UPDATE ON security.roles TO :"release_smoke_role";
GRANT SELECT, INSERT ON security.role_permissions TO :"release_smoke_role";
GRANT SELECT, INSERT, UPDATE ON security.membership_roles TO :"release_smoke_role";
GRANT SELECT, INSERT ON security.organizational_scopes TO :"release_smoke_role";
GRANT SELECT, INSERT ON security.role_assignment_scopes TO :"release_smoke_role";

-- Destructive fixture reset remains constrained by RLS to the dedicated smoke tenant.
GRANT SELECT, DELETE ON idempotency.records TO :"release_smoke_role";
GRANT SELECT, INSERT, DELETE ON outbox.events TO :"release_smoke_role";
GRANT SELECT, INSERT, DELETE ON dlq.entries TO :"release_smoke_role";

-- E2E audit evidence is read-only from the fixture principal.
GRANT SELECT ON audit.audit_events TO :"release_smoke_role";

GRANT EXECUTE ON FUNCTION security.current_tenant_id() TO :"release_smoke_role";

-- Fail closed against system/cross-tenant operational surfaces.
REVOKE ALL PRIVILEGES ON jobs.jobs, jobs.system_jobs, dlq.system_entries
FROM :"release_smoke_role";
REVOKE EXECUTE ON FUNCTION outbox.claim_system_batch(INTEGER, BIGINT, UUID)
FROM :"release_smoke_role";
REVOKE EXECUTE ON FUNCTION outbox.mark_system_published(UUID, UUID)
FROM :"release_smoke_role";

COMMIT;
