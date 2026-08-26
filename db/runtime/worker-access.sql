-- Moventra TMS — PostgreSQL dedicated worker access contract
-- Phase 025 Durable Jobs / Outbox Dispatcher, hardened for phase 026 DLQ.
-- Apply with psql -v worker_role=<NOLOGIN authorization role> -f db/runtime/worker-access.sql
--
-- This role is intentionally smaller than the normal application runtime. It cannot
-- mutate tenant/domain data, cannot bypass RLS, cannot create objects and cannot append
-- arbitrary Outbox/DLQ records. Phase-026 DLQ capabilities will be granted only through
-- narrow database functions after the ingestion/reprocessing adapter is implemented.

\set ON_ERROR_STOP on
\if :{?worker_role}
\else
  \echo 'worker_role psql variable is required'
  \quit 3
\endif

GRANT USAGE ON SCHEMA jobs, outbox TO :"worker_role";
REVOKE CREATE ON SCHEMA jobs, outbox FROM :"worker_role";

-- Deny broad table access first so reruns converge.
REVOKE ALL PRIVILEGES ON jobs.jobs FROM :"worker_role";
REVOKE ALL PRIVILEGES ON jobs.system_jobs FROM :"worker_role";
REVOKE ALL PRIVILEGES ON outbox.events FROM :"worker_role";
REVOKE ALL PRIVILEGES ON SCHEMA dlq FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA dlq FROM :"worker_role";

-- The phase-025 worker executes only migration-owned system schedules. It may read the
-- system job record and mutate lifecycle/lease columns, but not redefine handler type,
-- payload, metadata, schedule key or recurrence.
GRANT SELECT ON jobs.system_jobs TO :"worker_role";
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
  updated_at
) ON jobs.system_jobs TO :"worker_role";

REVOKE INSERT, DELETE ON jobs.system_jobs FROM :"worker_role";
REVOKE UPDATE (job_type, schema_version, payload, metadata, priority, max_attempts, schedule_key, recurrence_interval_ms)
  ON jobs.system_jobs FROM :"worker_role";

-- No direct Outbox table privilege is granted. Cross-tenant dispatch is available only
-- through SECURITY DEFINER functions whose SQL contract bounds claim size/TTL and requires
-- ownership by claim_token before marking an event as published.
GRANT EXECUTE ON FUNCTION outbox.claim_system_batch(INTEGER, BIGINT, UUID) TO :"worker_role";
GRANT EXECUTE ON FUNCTION outbox.mark_system_published(UUID, UUID) TO :"worker_role";

-- Phase 026 fail-closed posture: until the dedicated DLQ ingestion/reprocess capability is
-- merged and validated, the worker receives no direct or implicit DLQ access.
REVOKE ALL PRIVILEGES ON dlq.entries FROM :"worker_role";
REVOKE ALL PRIVILEGES ON dlq.system_entries FROM :"worker_role";

-- Explicitly deny all current business/application schemas to reduce blast radius.
REVOKE ALL PRIVILEGES ON SCHEMA organization, identity, security, audit, configuration, feature_flags, idempotency FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA organization, identity, security, audit, configuration, feature_flags, idempotency FROM :"worker_role";

REVOKE ALL PRIVILEGES ON SCHEMA moventra_meta FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA moventra_meta FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA moventra_meta FROM :"worker_role";
