-- Moventra TMS — Validation 0016: Durable Jobs
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  policy_count INTEGER;
  nullable_tenant BOOLEAN;
BEGIN
  IF to_regclass('jobs.jobs') IS NULL THEN
    RAISE EXCEPTION 'jobs.jobs is missing';
  END IF;
  IF to_regclass('jobs.system_jobs') IS NULL THEN
    RAISE EXCEPTION 'jobs.system_jobs is missing';
  END IF;

  SELECT NOT a.attnotnull INTO nullable_tenant
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'jobs'
     AND c.relname = 'jobs'
     AND a.attname = 'tenant_id'
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF nullable_tenant IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'jobs.jobs.tenant_id must be NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'jobs' AND table_name = 'system_jobs' AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'jobs.system_jobs must remain technical/global and must not carry tenant_id';
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
     AND policyname = 'tenant_isolation_jobs_jobs';
  IF policy_count <> 1 THEN
    RAISE EXCEPTION 'tenant jobs RLS policy is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'jobs' AND indexname = 'ix_jobs_jobs_eligibility'
  ) THEN
    RAISE EXCEPTION 'tenant jobs eligibility index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'jobs' AND indexname = 'ix_jobs_system_jobs_eligibility'
  ) THEN
    RAISE EXCEPTION 'system jobs eligibility index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'outbox' AND p.proname = 'claim_system_batch' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'outbox.claim_system_batch security definer is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jobs.system_jobs
     WHERE job_type = 'system.outbox_dispatch'
       AND schedule_key = 'system.outbox_dispatch'
       AND recurrence_interval_ms = 1000
  ) THEN
    RAISE EXCEPTION 'system.outbox_dispatch durable schedule is missing';
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
  id, tenant_id, job_type, schema_version, payload, metadata,
  status, priority, max_attempts
) VALUES (
  '01990250-0000-7000-8000-000000000010',
  '01990250-0000-7000-8000-000000000001',
  'freight.recalculate_eta', 1, '{}'::jsonb, '{}'::jsonb,
  'scheduled', 10, 5
);

DO $physical_scope$
DECLARE
  tenant_count INTEGER;
  system_count INTEGER;
BEGIN
  SELECT count(*) INTO tenant_count
    FROM jobs.jobs
   WHERE tenant_id = '01990250-0000-7000-8000-000000000001';
  IF tenant_count <> 1 THEN
    RAISE EXCEPTION 'tenant job physical scope validation failed';
  END IF;

  SELECT count(*) INTO system_count
    FROM jobs.system_jobs
   WHERE job_type = 'system.outbox_dispatch';
  IF system_count <> 1 THEN
    RAISE EXCEPTION 'system job physical scope validation failed';
  END IF;
END
$physical_scope$;

ROLLBACK;
