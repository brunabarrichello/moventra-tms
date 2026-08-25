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
  IF NOT has_table_privilege(runtime_role, 'jobs.jobs', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'jobs.jobs', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role lacks SELECT/INSERT on jobs.jobs';
  END IF;
  IF has_table_privilege(runtime_role, 'jobs.jobs', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role must not have table-wide UPDATE on jobs.jobs';
  END IF;
  IF has_table_privilege(runtime_role, 'jobs.jobs', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not DELETE jobs.jobs';
  END IF;

  IF NOT has_column_privilege(runtime_role, 'jobs.jobs', 'status', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'lease_token', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'lease_expires_at', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'last_error_code', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'jobs.jobs', 'updated_at', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks operational jobs UPDATE columns';
  END IF;

  IF has_column_privilege(runtime_role, 'jobs.jobs', 'tenant_id', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'scope', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'job_type', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'payload', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'metadata', 'UPDATE')
     OR has_column_privilege(runtime_role, 'jobs.jobs', 'schedule_key', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role can mutate immutable jobs contract columns';
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

-- System jobs are visible only without tenant context.
INSERT INTO jobs.jobs (
  id, tenant_id, scope, job_type, payload, metadata, schedule_key, recurrence_interval_ms
) VALUES (
  '01990251-0000-7000-8000-000000000010', NULL, 'system', 'system.outbox_dispatch',
  '{}'::jsonb, '{}'::jsonb, 'system.outbox_dispatch.runtime', 1000
);

SELECT set_config('moventra.tenant_id', '01990251-0000-7000-8000-000000000001', true);

INSERT INTO jobs.jobs (
  id, tenant_id, scope, job_type, payload, metadata
) VALUES (
  '01990251-0000-7000-8000-000000000011',
  '01990251-0000-7000-8000-000000000001',
  'tenant', 'freight.recalculate_eta', '{}'::jsonb, '{}'::jsonb
);

DO $rls$
DECLARE
  visible_system INTEGER;
  visible_other_tenant INTEGER;
BEGIN
  SELECT count(*) INTO visible_system
    FROM jobs.jobs
   WHERE id = '01990251-0000-7000-8000-000000000010';
  IF visible_system <> 0 THEN
    RAISE EXCEPTION 'system job leaked into tenant-scoped context';
  END IF;

  SELECT count(*) INTO visible_other_tenant
    FROM jobs.jobs
   WHERE tenant_id = '01990251-0000-7000-8000-000000000002';
  IF visible_other_tenant <> 0 THEN
    RAISE EXCEPTION 'cross-tenant jobs read was not isolated';
  END IF;

  BEGIN
    INSERT INTO jobs.jobs (tenant_id, scope, job_type, payload, metadata)
    VALUES (
      '01990251-0000-7000-8000-000000000002',
      'tenant', 'freight.recalculate_eta', '{}'::jsonb, '{}'::jsonb
    );
    RAISE EXCEPTION 'cross-tenant jobs write passed isolation boundary';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE jobs.jobs
       SET payload = '{"changed":true}'::jsonb
     WHERE id = '01990251-0000-7000-8000-000000000011';
    RAISE EXCEPTION 'runtime changed immutable jobs payload';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM jobs.jobs
     WHERE id = '01990251-0000-7000-8000-000000000011';
    RAISE EXCEPTION 'runtime deleted a job';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$rls$;

RESET ROLE;
ROLLBACK;
