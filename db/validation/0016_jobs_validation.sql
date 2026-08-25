-- Moventra TMS — Validation 0016: Durable Jobs
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  policy_count INTEGER;
BEGIN
  IF to_regclass('jobs.jobs') IS NULL THEN
    RAISE EXCEPTION 'jobs.jobs is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'jobs' AND c.relname = 'jobs' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'jobs.jobs must have RLS enabled';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'jobs' AND tablename = 'jobs'
     AND policyname = 'tenant_or_system_isolation_jobs';
  IF policy_count <> 1 THEN
    RAISE EXCEPTION 'jobs RLS policy is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'jobs' AND indexname = 'ix_jobs_eligibility'
  ) THEN
    RAISE EXCEPTION 'jobs eligibility index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'outbox' AND p.proname = 'claim_system_batch' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'outbox.claim_system_batch security definer is missing';
  END IF;
END
$validation$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES (
  '01990250-0000-7000-8000-000000000001', 'jobs-ci-a', 'Jobs CI A', 'ACTIVE', 'UTC', 'USD'
);

INSERT INTO jobs.jobs (
  id, tenant_id, scope, job_type, schema_version, payload, metadata,
  status, priority, max_attempts
) VALUES (
  '01990250-0000-7000-8000-000000000010',
  '01990250-0000-7000-8000-000000000001',
  'tenant', 'freight.recalculate_eta', 1, '{}'::jsonb, '{}'::jsonb,
  'scheduled', 10, 5
);

INSERT INTO jobs.jobs (
  id, tenant_id, scope, job_type, schema_version, payload, metadata,
  status, priority, max_attempts, schedule_key, recurrence_interval_ms
) VALUES (
  '01990250-0000-7000-8000-000000000011',
  NULL, 'system', 'system.outbox_dispatch', 1, '{}'::jsonb, '{}'::jsonb,
  'scheduled', 100, 10, 'system.outbox_dispatch', 1000
);

DO $lifecycle$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT count(*) INTO invalid_count
    FROM jobs.jobs
   WHERE (scope = 'tenant' AND tenant_id IS NULL)
      OR (scope = 'system' AND tenant_id IS NOT NULL);
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'jobs scope/tenant constraint is invalid';
  END IF;
END
$lifecycle$;

ROLLBACK;
