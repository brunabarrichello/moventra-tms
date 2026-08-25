-- Moventra TMS — Phase 025 Durable Jobs runtime access validation
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

DO $acl$
DECLARE
  runtime_role TEXT := current_setting('moventra.validation_runtime_role');
BEGIN
  IF NOT has_schema_privilege(runtime_role, 'jobs', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role lacks USAGE on jobs schema';
  END IF;
  IF has_schema_privilege(runtime_role, 'jobs', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role must not CREATE in jobs schema';
  END IF;

  -- Tenant-scoped jobs: authorized application workflows may schedule; RLS isolates ownership.
  IF NOT has_table_privilege(runtime_role, 'jobs.jobs', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'jobs.jobs', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role lacks SELECT/INSERT on tenant jobs';
  END IF;
  IF has_table_privilege(runtime_role, 'jobs.jobs', 'UPDATE')
     OR has_table_privilege(runtime_role, 'jobs.jobs', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role has broad mutation on tenant jobs';
  END IF;
  IF NOT has_column_privilege(runtime_role, 'jobs.jobs', 'status', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'lease_token', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'lease_expires_at', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'last_error_code', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'updated_at', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks tenant job lifecycle UPDATE columns';
  END IF;
  IF has_column_privilege(runtime_role, 'jobs.jobs', 'tenant_id', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'job_type', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'payload', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'metadata', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'schedule_key', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role can mutate immutable tenant job contract columns';
  END IF;

  -- System jobs: schedules are migration-owned. Runtime executes lifecycle only.
  IF NOT has_table_privilege(runtime_role, 'jobs.system_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role lacks SELECT on system jobs';
  END IF;
  IF has_table_privilege(runtime_role, 'jobs.system_jobs', 'INSERT')
     OR has_table_privilege(runtime_role, 'jobs.system_jobs', 'UPDATE')
     OR has_table_privilege(runtime_role, 'jobs.system_jobs', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role has broad system job mutation privileges';
  END IF;
  IF NOT has_column_privilege(runtime_role, 'jobs.system_jobs', 'status', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.system_jobs', 'lease_token', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.system_jobs', 'lease_expires_at', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.system_jobs', 'last_error_code', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.system_jobs', 'updated_at', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks system job lifecycle UPDATE columns';
  END IF;
  IF has_column_privilege(runtime_role, 'jobs.system_jobs', 'job_type', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.system_jobs', 'payload', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.system_jobs', 'metadata', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.system_jobs', 'schedule_key', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.system_jobs', 'recurrence_interval_ms', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role can redefine a migration-owned system schedule';
  END IF;

  IF NOT has_function_privilege(runtime_role, 'outbox.claim_system_batch(integer,bigint,uuid)', 'EXECUTE')
     OR NOT has_function_privilege(runtime_role, 'outbox.mark_system_published(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime role lacks narrow system Outbox dispatcher capabilities';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'jobs'
       AND c.relname = 'jobs'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled for jobs.jobs';
  END IF;
END
$acl$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990251-0000-7000-8000-000000000001', 'runtime-jobs-a', 'Runtime Jobs A', 'ACTIVE', 'UTC', 'USD'),
  ('01990251-0000-7000-8000-000000000002', 'runtime-jobs-b', 'Runtime Jobs B', 'ACTIVE', 'UTC', 'USD');

SET ROLE :"app_role";

-- The seeded global system schedule can be read/executed but cannot be created by runtime.
DO $system_acl$
DECLARE
  system_count INTEGER;
BEGIN
  SELECT count(*) INTO system_count
    FROM jobs.system_jobs
   WHERE job_type = 'system.outbox_dispatch';
  IF system_count <> 1 THEN
    RAISE EXCEPTION 'seeded system outbox job is not visible to runtime';
  END IF;

  BEGIN
    INSERT INTO jobs.system_jobs (job_type, payload, metadata)
    VALUES ('system.unauthorized_runtime_schedule', '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'runtime created a system job';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE jobs.system_jobs
       SET payload = '{"changed":true}'::jsonb
     WHERE job_type = 'system.outbox_dispatch';
    RAISE EXCEPTION 'runtime changed immutable system job payload';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$system_acl$;

SELECT set_config('moventra.tenant_id', '01990251-0000-7000-8000-000000000001', true);

INSERT INTO jobs.jobs (
  id, tenant_id, job_type, payload, metadata
) VALUES (
  '01990251-0000-7000-8000-000000000011',
  '01990251-0000-7000-8000-000000000001',
  'freight.recalculate_eta', '{}'::jsonb, '{}'::jsonb
);

DO $rls$
DECLARE
  visible_other_tenant INTEGER;
BEGIN
  SELECT count(*) INTO visible_other_tenant
    FROM jobs.jobs
   WHERE tenant_id = '01990251-0000-7000-8000-000000000002';
  IF visible_other_tenant <> 0 THEN
    RAISE EXCEPTION 'cross-tenant jobs read was not isolated';
  END IF;

  BEGIN
    INSERT INTO jobs.jobs (tenant_id, job_type, payload, metadata)
    VALUES (
      '01990251-0000-7000-8000-000000000002',
      'freight.recalculate_eta', '{}'::jsonb, '{}'::jsonb
    );
    RAISE EXCEPTION 'cross-tenant jobs write passed isolation boundary';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE jobs.jobs
       SET payload = '{"changed":true}'::jsonb
     WHERE id = '01990251-0000-7000-8000-000000000011';
    RAISE EXCEPTION 'runtime changed immutable tenant job payload';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM jobs.jobs
     WHERE id = '01990251-0000-7000-8000-000000000011';
    RAISE EXCEPTION 'runtime deleted a tenant job';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$rls$;

RESET ROLE;
ROLLBACK;
