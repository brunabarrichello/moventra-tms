-- Moventra TMS — Phase 025 dedicated worker access validation
-- Requires psql variables worker_role and worker_app_role.
\set ON_ERROR_STOP on
\if :{?worker_role}
\else
  \echo 'worker_role psql variable is required'
  \quit 3
\endif
\if :{?worker_app_role}
\else
  \echo 'worker_app_role psql variable is required'
  \quit 3
\endif

SELECT set_config('moventra.validation_worker_role', :'worker_role', false);
SELECT set_config('moventra.validation_worker_app_role', :'worker_app_role', false);

DO $acl$
DECLARE
  worker_role TEXT := current_setting('moventra.validation_worker_role');
  worker_app_role TEXT := current_setting('moventra.validation_worker_app_role');
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = worker_role
       AND NOT rolcanlogin
       AND NOT rolsuper
       AND NOT rolcreatedb
       AND NOT rolcreaterole
       AND NOT rolreplication
       AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'worker authorization role must be NOLOGIN and NOBYPASSRLS without elevated attributes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = worker_app_role
       AND rolcanlogin
       AND NOT rolsuper
       AND NOT rolcreatedb
       AND NOT rolcreaterole
       AND NOT rolreplication
       AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'worker application role must be LOGIN and NOBYPASSRLS without elevated attributes';
  END IF;

  IF NOT pg_has_role(worker_app_role, worker_role, 'MEMBER') THEN
    RAISE EXCEPTION 'worker application role must inherit the dedicated worker authorization role';
  END IF;

  IF NOT has_schema_privilege(worker_role, 'jobs', 'USAGE')
     OR NOT has_schema_privilege(worker_role, 'outbox', 'USAGE') THEN
    RAISE EXCEPTION 'worker lacks required jobs/outbox schema USAGE';
  END IF;
  IF has_schema_privilege(worker_role, 'jobs', 'CREATE')
     OR has_schema_privilege(worker_role, 'outbox', 'CREATE') THEN
    RAISE EXCEPTION 'worker must not CREATE in jobs/outbox schemas';
  END IF;

  IF NOT has_table_privilege(worker_role, 'jobs.system_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'worker must read system jobs';
  END IF;
  IF has_table_privilege(worker_role, 'jobs.system_jobs', 'INSERT')
     OR has_table_privilege(worker_role, 'jobs.system_jobs', 'UPDATE')
     OR has_table_privilege(worker_role, 'jobs.system_jobs', 'DELETE') THEN
    RAISE EXCEPTION 'worker must not have broad system_jobs mutation';
  END IF;
  IF NOT has_column_privilege(worker_role, 'jobs.system_jobs', 'status', 'UPDATE')
     OR NOT has_column_privilege(worker_role, 'jobs.system_jobs', 'lease_token', 'UPDATE')
     OR NOT has_column_privilege(worker_role, 'jobs.system_jobs', 'lease_expires_at', 'UPDATE')
     OR NOT has_column_privilege(worker_role, 'jobs.system_jobs', 'last_completed_at', 'UPDATE') THEN
    RAISE EXCEPTION 'worker lacks system job lifecycle privileges';
  END IF;
  IF has_column_privilege(worker_role, 'jobs.system_jobs', 'job_type', 'UPDATE')
     OR has_column_privilege(worker_role, 'jobs.system_jobs', 'payload', 'UPDATE')
     OR has_column_privilege(worker_role, 'jobs.system_jobs', 'metadata', 'UPDATE')
     OR has_column_privilege(worker_role, 'jobs.system_jobs', 'schedule_key', 'UPDATE')
     OR has_column_privilege(worker_role, 'jobs.system_jobs', 'recurrence_interval_ms', 'UPDATE') THEN
    RAISE EXCEPTION 'worker can redefine immutable system schedule contract';
  END IF;

  IF has_table_privilege(worker_role, 'jobs.jobs', 'SELECT')
     OR has_table_privilege(worker_role, 'jobs.jobs', 'INSERT')
     OR has_table_privilege(worker_role, 'jobs.jobs', 'UPDATE')
     OR has_table_privilege(worker_role, 'jobs.jobs', 'DELETE') THEN
    RAISE EXCEPTION 'phase-025 system worker must not access tenant jobs directly';
  END IF;

  IF has_table_privilege(worker_role, 'outbox.events', 'SELECT')
     OR has_table_privilege(worker_role, 'outbox.events', 'INSERT')
     OR has_table_privilege(worker_role, 'outbox.events', 'UPDATE')
     OR has_table_privilege(worker_role, 'outbox.events', 'DELETE') THEN
    RAISE EXCEPTION 'worker must not access Outbox table directly';
  END IF;

  IF NOT has_function_privilege(worker_role, 'outbox.claim_system_batch(integer,bigint,uuid)', 'EXECUTE')
     OR NOT has_function_privilege(worker_role, 'outbox.mark_system_published(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'worker lacks narrow Outbox dispatcher capabilities';
  END IF;

  IF has_schema_privilege(worker_role, 'organization', 'USAGE')
     OR has_schema_privilege(worker_role, 'identity', 'USAGE')
     OR has_schema_privilege(worker_role, 'security', 'USAGE')
     OR has_schema_privilege(worker_role, 'audit', 'USAGE') THEN
    RAISE EXCEPTION 'worker blast radius includes forbidden business/security schemas';
  END IF;
END
$acl$;

BEGIN;
SET ROLE :"worker_app_role";

DO $negative$
BEGIN
  BEGIN
    INSERT INTO jobs.system_jobs (job_type, payload, metadata)
    VALUES ('system.unauthorized_worker_schedule', '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'worker created a system schedule';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE jobs.system_jobs
       SET payload = '{"changed":true}'::jsonb
     WHERE job_type = 'system.outbox_dispatch';
    RAISE EXCEPTION 'worker changed immutable system payload';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    SELECT 1 FROM jobs.jobs LIMIT 1;
    RAISE EXCEPTION 'worker read tenant jobs directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    SELECT 1 FROM outbox.events LIMIT 1;
    RAISE EXCEPTION 'worker read Outbox directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$negative$;

RESET ROLE;
ROLLBACK;
