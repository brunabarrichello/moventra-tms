-- Moventra TMS — PostgreSQL dedicated worker access contract
-- Phase 025 Durable Jobs / Outbox Dispatcher + Phase 026 DLQ ingestion.
-- Apply with psql -v worker_role=<NOLOGIN authorization role> -f db/runtime/worker-access.sql
--
-- This role is intentionally smaller than the normal application runtime. It cannot
-- mutate tenant/domain data, cannot bypass RLS, cannot create objects and cannot access
-- Outbox/DLQ tables directly. Cross-tenant capabilities are narrow SECURITY DEFINER functions.

\set ON_ERROR_STOP on
\if :{?worker_role}
\else
  \echo 'worker_role psql variable is required'
  \quit 3
\endif

GRANT USAGE ON SCHEMA jobs, outbox, dlq TO :"worker_role";
REVOKE CREATE ON SCHEMA jobs, outbox, dlq FROM :"worker_role";

-- Deny broad table access first so reruns converge.
REVOKE ALL PRIVILEGES ON jobs.jobs FROM :"worker_role";
REVOKE ALL PRIVILEGES ON jobs.system_jobs FROM :"worker_role";
REVOKE ALL PRIVILEGES ON outbox.events FROM :"worker_role";
REVOKE ALL PRIVILEGES ON dlq.entries FROM :"worker_role";
REVOKE ALL PRIVILEGES ON dlq.system_entries FROM :"worker_role";

-- The worker executes only migration-owned system schedules. It may read the system job
-- record and mutate lifecycle/lease columns, but not redefine handler type, payload,
-- metadata, schedule key or recurrence.
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

-- Phase 026: the worker can quarantine a dead-lettered message only through a function
-- that derives tenant_id/source contract from the authoritative Outbox row. The worker
-- cannot SELECT/INSERT/UPDATE/DELETE either DLQ table directly.
GRANT EXECUTE ON FUNCTION dlq.quarantine_outbox_message(UUID, TEXT, TEXT, JSONB, SMALLINT)
  TO :"worker_role";

-- Explicitly deny all current business/application schemas to reduce blast radius.
REVOKE ALL PRIVILEGES ON SCHEMA organization, identity, security, audit, configuration, feature_flags, idempotency FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA organization, identity, security, audit, configuration, feature_flags, idempotency FROM :"worker_role";

REVOKE ALL PRIVILEGES ON SCHEMA moventra_meta FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA moventra_meta FROM :"worker_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA moventra_meta FROM :"worker_role";
