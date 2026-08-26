-- Moventra TMS — Phase 026 / Batch 3 terminal Job capture validation
\set ON_ERROR_STOP on

DO $contract$
DECLARE
    tenant_function_oid OID;
    system_function_oid OID;
BEGIN
    SELECT to_regprocedure('dlq.capture_terminal_tenant_job()')
      INTO tenant_function_oid;
    SELECT to_regprocedure('dlq.capture_terminal_system_job()')
      INTO system_function_oid;

    IF tenant_function_oid IS NULL OR system_function_oid IS NULL THEN
        RAISE EXCEPTION 'DLQ terminal Job capture functions are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE oid = tenant_function_oid AND prosecdef
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE oid = system_function_oid AND prosecdef
    ) THEN
        RAISE EXCEPTION 'DLQ terminal Job capture functions must be SECURITY DEFINER';
    END IF;

    IF has_function_privilege('public', 'dlq.capture_terminal_tenant_job()', 'EXECUTE')
       OR has_function_privilege('public', 'dlq.capture_terminal_system_job()', 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC must not execute DLQ terminal Job capture functions';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger AS trigger
          JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
          JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'jobs'
           AND relation.relname = 'jobs'
           AND trigger.tgname = 'trg_jobs_jobs_capture_terminal_dlq'
           AND NOT trigger.tgisinternal
           AND trigger.tgenabled <> 'D'
    ) THEN
        RAISE EXCEPTION 'tenant Job terminal DLQ trigger is missing or disabled';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger AS trigger
          JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
          JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'jobs'
           AND relation.relname = 'system_jobs'
           AND trigger.tgname = 'trg_jobs_system_jobs_capture_terminal_dlq'
           AND NOT trigger.tgisinternal
           AND trigger.tgenabled <> 'D'
    ) THEN
        RAISE EXCEPTION 'system Job terminal DLQ trigger is missing or disabled';
    END IF;
END
$contract$;

DO $tenant_capture$
DECLARE
    v_tenant_id UUID := '01990260-1000-7000-8000-000000000001'::uuid;
    v_job_id UUID := '01990260-1000-7000-8000-000000000002'::uuid;
    v_lease_token UUID := '01990260-1000-7000-8000-000000000003'::uuid;
    v_dlq_count INTEGER;
    v_entry RECORD;
BEGIN
    DELETE FROM dlq.entries
     WHERE tenant_id = v_tenant_id
       AND source_kind = 'job'
       AND source_id = v_job_id;
    DELETE FROM jobs.jobs WHERE id = v_job_id;
    DELETE FROM organization.tenants WHERE id = v_tenant_id;

    INSERT INTO organization.tenants (
        id, code, display_name, status, default_timezone, default_currency
    ) VALUES (
        v_tenant_id,
        'dlq-ci-tenant',
        'DLQ CI Tenant',
        'ACTIVE',
        'America/Sao_Paulo',
        'BRL'
    );

    INSERT INTO jobs.jobs (
        id,
        tenant_id,
        job_type,
        schema_version,
        payload,
        metadata,
        status,
        attempt_count,
        max_attempts,
        lease_token,
        leased_at,
        lease_expires_at,
        last_heartbeat_at
    ) VALUES (
        v_job_id,
        v_tenant_id,
        'test.terminal_capture',
        1,
        '{"secretSentinel":"MUST_NOT_COPY","business":"bounded"}'::jsonb,
        '{"test":"phase-026-batch-3"}'::jsonb,
        'running',
        2,
        2,
        v_lease_token,
        clock_timestamp(),
        clock_timestamp() + interval '5 minutes',
        clock_timestamp()
    );

    UPDATE jobs.jobs
       SET status = 'failed_terminal',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_heartbeat_at = NULL,
           last_error_code = 'MVT_JOB_TEST_TERMINAL',
           last_error_class = 'non_retryable',
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE id = v_job_id;

    SELECT count(*)
      INTO v_dlq_count
      FROM dlq.entries
     WHERE tenant_id = v_tenant_id
       AND source_kind = 'job'
       AND source_id = v_job_id;

    IF v_dlq_count <> 1 THEN
        RAISE EXCEPTION 'tenant terminal Job expected exactly one DLQ entry, got %', v_dlq_count;
    END IF;

    SELECT *
      INTO v_entry
      FROM dlq.entries
     WHERE tenant_id = v_tenant_id
       AND source_kind = 'job'
       AND source_id = v_job_id;

    IF v_entry.source_type <> 'test.terminal_capture'
       OR v_entry.source_schema_version <> 1
       OR v_entry.failure_code <> 'MVT_JOB_TEST_TERMINAL'
       OR v_entry.failure_class <> 'non_retryable'
       OR v_entry.status <> 'quarantined' THEN
        RAISE EXCEPTION 'tenant terminal Job DLQ metadata does not match authoritative Job state';
    END IF;

    IF v_entry.snapshot ->> 'tenantId' <> v_tenant_id::text
       OR v_entry.snapshot ->> 'jobId' <> v_job_id::text
       OR v_entry.snapshot #>> '{payload,omitted}' <> 'authoritative_job_reference' THEN
        RAISE EXCEPTION 'tenant terminal Job snapshot contract is invalid';
    END IF;

    IF v_entry.snapshot::text LIKE '%MUST_NOT_COPY%'
       OR v_entry.snapshot::text LIKE '%"business"%' THEN
        RAISE EXCEPTION 'tenant terminal Job copied raw Job payload into DLQ snapshot';
    END IF;

    -- An update that leaves the terminal state unchanged must not create another logical row.
    UPDATE jobs.jobs
       SET status = 'failed_terminal',
           updated_at = clock_timestamp()
     WHERE id = v_job_id;

    SELECT count(*)
      INTO v_dlq_count
      FROM dlq.entries
     WHERE tenant_id = v_tenant_id
       AND source_kind = 'job'
       AND source_id = v_job_id;

    IF v_dlq_count <> 1 THEN
        RAISE EXCEPTION 'tenant terminal Job DLQ dedupe failed';
    END IF;

    DELETE FROM dlq.entries
     WHERE tenant_id = v_tenant_id
       AND source_kind = 'job'
       AND source_id = v_job_id;
    DELETE FROM jobs.jobs WHERE id = v_job_id;
    DELETE FROM organization.tenants WHERE id = v_tenant_id;
END
$tenant_capture$;

DO $system_capture$
DECLARE
    v_job_id UUID := '01990260-2000-7000-8000-000000000001'::uuid;
    v_lease_token UUID := '01990260-2000-7000-8000-000000000002'::uuid;
    v_dlq_count INTEGER;
    v_entry RECORD;
BEGIN
    DELETE FROM dlq.system_entries
     WHERE source_kind = 'job'
       AND source_id = v_job_id;
    DELETE FROM jobs.system_jobs WHERE id = v_job_id;

    INSERT INTO jobs.system_jobs (
        id,
        job_type,
        schema_version,
        payload,
        metadata,
        status,
        attempt_count,
        max_attempts,
        lease_token,
        leased_at,
        lease_expires_at,
        last_heartbeat_at
    ) VALUES (
        v_job_id,
        'system.dlq_terminal_test',
        1,
        '{"secretSentinel":"MUST_NOT_COPY_SYSTEM"}'::jsonb,
        '{"test":"phase-026-batch-3"}'::jsonb,
        'running',
        3,
        3,
        v_lease_token,
        clock_timestamp(),
        clock_timestamp() + interval '5 minutes',
        clock_timestamp()
    );

    UPDATE jobs.system_jobs
       SET status = 'failed_terminal',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_heartbeat_at = NULL,
           last_error_code = 'MVT_SYSTEM_JOB_TERMINAL',
           last_error_class = 'retry_exhausted',
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE id = v_job_id;

    SELECT count(*)
      INTO v_dlq_count
      FROM dlq.system_entries
     WHERE source_kind = 'job'
       AND source_id = v_job_id;

    IF v_dlq_count <> 1 THEN
        RAISE EXCEPTION 'system terminal Job expected exactly one DLQ entry, got %', v_dlq_count;
    END IF;

    SELECT *
      INTO v_entry
      FROM dlq.system_entries
     WHERE source_kind = 'job'
       AND source_id = v_job_id;

    IF v_entry.source_type <> 'system.dlq_terminal_test'
       OR v_entry.failure_code <> 'MVT_SYSTEM_JOB_TERMINAL'
       OR v_entry.failure_class <> 'retry_exhausted'
       OR v_entry.status <> 'quarantined'
       OR v_entry.snapshot #>> '{payload,omitted}' <> 'authoritative_job_reference' THEN
        RAISE EXCEPTION 'system terminal Job DLQ contract is invalid';
    END IF;

    IF v_entry.snapshot::text LIKE '%MUST_NOT_COPY_SYSTEM%' THEN
        RAISE EXCEPTION 'system terminal Job copied raw Job payload into DLQ snapshot';
    END IF;

    UPDATE jobs.system_jobs
       SET status = 'failed_terminal',
           updated_at = clock_timestamp()
     WHERE id = v_job_id;

    SELECT count(*)
      INTO v_dlq_count
      FROM dlq.system_entries
     WHERE source_kind = 'job'
       AND source_id = v_job_id;

    IF v_dlq_count <> 1 THEN
        RAISE EXCEPTION 'system terminal Job DLQ dedupe failed';
    END IF;

    DELETE FROM dlq.system_entries
     WHERE source_kind = 'job'
       AND source_id = v_job_id;
    DELETE FROM jobs.system_jobs WHERE id = v_job_id;
END
$system_capture$;
