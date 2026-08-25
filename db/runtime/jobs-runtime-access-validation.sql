-- Moventra TMS — Phase 025 application runtime Jobs access validation
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

  -- Tenant-scoped jobs are available only through normal tenant RLS.
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
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'updated_at', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks tenant job lifecycle columns';
  END IF;
  IF has_column_privilege(runtime_role, 'jobs.jobs', 'tenant_id', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'job_type', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'payload', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'metadata', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'schedule_key', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role can mutate immutable tenant job contract columns';
  END IF;

  -- P0 boundary: normal HTTP/application runtime cannot inspect or execute platform system jobs.
  IF has_table_privilege(runtime_role, 'jobs.system_jobs', 'SELECT')
     OR has_table_privilege(runtime_role, 'jobs.system_jobs', 'INSERT')
     OR has_table_privilege(runtime_role, 'jobs.system_jobs', 'UPDATE')
     OR has_table_privilege(runtime_role, 'jobs.system_jobs', 'DELETE') THEN
    RAISE EXCEPTION 'application runtime must not access system jobs';
  END IF;
  IF has_function_privilege(runtime_role, 'outbox.claim_system_batch(integer,bigint,uuid)', 'EXECUTE')
     OR has_function_privilege(runtime_role, 'outbox.mark_system_published(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'application runtime must not hold cross-tenant Outbox dispatcher capability';
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

DO $system_boundary$
BEGIN
  BEGIN
    SELECT 1 FROM jobs.system_jobs LIMIT 1;
    RAISE EXCEPTION 'application runtime read system jobs';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM * FROM outbox.claim_system_batch(1, 1000, '01990251-0000-7000-8000-000000000099');
    RAISE EXCEPTION 'application runtime invoked system Outbox claim';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$system_boundary$;

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
