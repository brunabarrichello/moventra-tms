-- Moventra TMS — Phase 026 governed Job reprocessing lineage validation
\set ON_ERROR_STOP on

DO $contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'jobs' AND table_name = 'jobs'
       AND column_name = 'reprocessed_from_job_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'jobs' AND table_name = 'jobs'
       AND column_name = 'reprocessed_from_dlq_entry_id'
  ) THEN
    RAISE EXCEPTION 'tenant Job reprocessing lineage columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'jobs' AND table_name = 'system_jobs'
       AND column_name = 'reprocessed_from_job_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'jobs' AND table_name = 'system_jobs'
       AND column_name = 'reprocessed_from_dlq_entry_id'
  ) THEN
    RAISE EXCEPTION 'system Job reprocessing lineage columns are missing';
  END IF;

  IF to_regclass('jobs.ux_jobs_jobs_reprocessed_from_dlq') IS NULL
     OR to_regclass('jobs.ux_jobs_system_jobs_reprocessed_from_dlq') IS NULL THEN
    RAISE EXCEPTION 'Job replay idempotency unique indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_jobs_jobs_reprocessed_from_job'
       AND conrelid = 'jobs.jobs'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_jobs_jobs_reprocessed_from_dlq'
       AND conrelid = 'jobs.jobs'::regclass
  ) THEN
    RAISE EXCEPTION 'tenant Job replay lineage foreign keys are missing';
  END IF;
END
$contract$;

DO $tenant_lineage$
DECLARE
  v_tenant_a UUID := '01990260-3000-7000-8000-000000000001'::uuid;
  v_tenant_b UUID := '01990260-3000-7000-8000-000000000002'::uuid;
  v_source_a UUID := '01990260-3000-7000-8000-000000000011'::uuid;
  v_source_b UUID := '01990260-3000-7000-8000-000000000012'::uuid;
  v_child_a UUID := '01990260-3000-7000-8000-000000000021'::uuid;
  v_child_dup UUID := '01990260-3000-7000-8000-000000000022'::uuid;
  v_child_cross UUID := '01990260-3000-7000-8000-000000000023'::uuid;
  v_lease_a UUID := '01990260-3000-7000-8000-000000000031'::uuid;
  v_lease_b UUID := '01990260-3000-7000-8000-000000000032'::uuid;
  v_dlq_a UUID;
  v_dlq_b UUID;
  v_unique_rejected BOOLEAN := false;
  v_cross_rejected BOOLEAN := false;
BEGIN
  DELETE FROM jobs.jobs WHERE id IN (v_child_a, v_child_dup, v_child_cross, v_source_a, v_source_b);
  DELETE FROM dlq.entries WHERE tenant_id IN (v_tenant_a, v_tenant_b) AND source_kind = 'job';
  DELETE FROM organization.tenants WHERE id IN (v_tenant_a, v_tenant_b);

  INSERT INTO organization.tenants (id, code, display_name, status, default_timezone, default_currency)
  VALUES
    (v_tenant_a, 'dlq-rp-a', 'DLQ Replay A', 'ACTIVE', 'America/Sao_Paulo', 'BRL'),
    (v_tenant_b, 'dlq-rp-b', 'DLQ Replay B', 'ACTIVE', 'America/Sao_Paulo', 'BRL');

  INSERT INTO jobs.jobs (
    id, tenant_id, job_type, schema_version, payload, metadata,
    status, attempt_count, max_attempts, lease_token, leased_at, lease_expires_at, last_heartbeat_at
  ) VALUES
    (v_source_a, v_tenant_a, 'test.governed_replay', 1, '{"source":"a"}', '{}',
     'running', 2, 2, v_lease_a, clock_timestamp(), clock_timestamp() + interval '5 minutes', clock_timestamp()),
    (v_source_b, v_tenant_b, 'test.governed_replay', 1, '{"source":"b"}', '{}',
     'running', 2, 2, v_lease_b, clock_timestamp(), clock_timestamp() + interval '5 minutes', clock_timestamp());

  UPDATE jobs.jobs
     SET status = 'failed_terminal', lease_token = NULL, leased_at = NULL,
         lease_expires_at = NULL, last_heartbeat_at = NULL,
         last_error_code = 'MVT_JOB_REPLAY_TEST', last_error_class = 'terminal',
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id IN (v_source_a, v_source_b);

  SELECT id INTO STRICT v_dlq_a
    FROM dlq.entries
   WHERE tenant_id = v_tenant_a AND source_kind = 'job' AND source_id = v_source_a;
  SELECT id INTO STRICT v_dlq_b
    FROM dlq.entries
   WHERE tenant_id = v_tenant_b AND source_kind = 'job' AND source_id = v_source_b;

  INSERT INTO jobs.jobs (
    id, tenant_id, job_type, schema_version, payload, metadata, status,
    priority, max_attempts, reprocessed_from_job_id, reprocessed_from_dlq_entry_id
  ) VALUES (
    v_child_a, v_tenant_a, 'test.governed_replay', 1, '{"source":"a"}', '{}', 'scheduled',
    0, 2, v_source_a, v_dlq_a
  );

  BEGIN
    INSERT INTO jobs.jobs (
      id, tenant_id, job_type, schema_version, payload, metadata, status,
      priority, max_attempts, reprocessed_from_job_id, reprocessed_from_dlq_entry_id
    ) VALUES (
      v_child_dup, v_tenant_a, 'test.governed_replay', 1, '{"source":"a"}', '{}', 'scheduled',
      0, 2, v_source_a, v_dlq_a
    );
  EXCEPTION WHEN unique_violation THEN
    v_unique_rejected := true;
  END;

  IF NOT v_unique_rejected THEN
    RAISE EXCEPTION 'same DLQ entry created more than one logical replay Job';
  END IF;

  BEGIN
    INSERT INTO jobs.jobs (
      id, tenant_id, job_type, schema_version, payload, metadata, status,
      priority, max_attempts, reprocessed_from_job_id, reprocessed_from_dlq_entry_id
    ) VALUES (
      v_child_cross, v_tenant_a, 'test.governed_replay', 1, '{"source":"cross"}', '{}', 'scheduled',
      0, 2, v_source_b, v_dlq_b
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_cross_rejected := true;
  END;

  IF NOT v_cross_rejected THEN
    RAISE EXCEPTION 'tenant Job replay lineage accepted cross-tenant source/DLQ references';
  END IF;

  DELETE FROM jobs.jobs WHERE id = v_child_a;
  DELETE FROM dlq.entries WHERE id IN (v_dlq_a, v_dlq_b);
  DELETE FROM jobs.jobs WHERE id IN (v_source_a, v_source_b);
  DELETE FROM organization.tenants WHERE id IN (v_tenant_a, v_tenant_b);
END
$tenant_lineage$;

DO $system_lineage$
DECLARE
  v_source UUID := '01990260-4000-7000-8000-000000000011'::uuid;
  v_child UUID := '01990260-4000-7000-8000-000000000021'::uuid;
  v_dup UUID := '01990260-4000-7000-8000-000000000022'::uuid;
  v_lease UUID := '01990260-4000-7000-8000-000000000031'::uuid;
  v_dlq UUID;
  v_unique_rejected BOOLEAN := false;
BEGIN
  DELETE FROM jobs.system_jobs WHERE id IN (v_child, v_dup, v_source);
  DELETE FROM dlq.system_entries WHERE source_kind = 'job' AND source_id = v_source;

  INSERT INTO jobs.system_jobs (
    id, job_type, schema_version, payload, metadata,
    status, attempt_count, max_attempts, lease_token, leased_at, lease_expires_at, last_heartbeat_at
  ) VALUES (
    v_source, 'system.governed_replay_test', 1, '{}', '{}',
    'running', 2, 2, v_lease, clock_timestamp(), clock_timestamp() + interval '5 minutes', clock_timestamp()
  );

  UPDATE jobs.system_jobs
     SET status = 'failed_terminal', lease_token = NULL, leased_at = NULL,
         lease_expires_at = NULL, last_heartbeat_at = NULL,
         last_error_code = 'MVT_SYSTEM_REPLAY_TEST', last_error_class = 'terminal',
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = v_source;

  SELECT id INTO STRICT v_dlq
    FROM dlq.system_entries
   WHERE source_kind = 'job' AND source_id = v_source;

  INSERT INTO jobs.system_jobs (
    id, job_type, schema_version, payload, metadata, status,
    priority, max_attempts, reprocessed_from_job_id, reprocessed_from_dlq_entry_id
  ) VALUES (
    v_child, 'system.governed_replay_test', 1, '{}', '{}', 'scheduled',
    0, 2, v_source, v_dlq
  );

  BEGIN
    INSERT INTO jobs.system_jobs (
      id, job_type, schema_version, payload, metadata, status,
      priority, max_attempts, reprocessed_from_job_id, reprocessed_from_dlq_entry_id
    ) VALUES (
      v_dup, 'system.governed_replay_test', 1, '{}', '{}', 'scheduled',
      0, 2, v_source, v_dlq
    );
  EXCEPTION WHEN unique_violation THEN
    v_unique_rejected := true;
  END;

  IF NOT v_unique_rejected THEN
    RAISE EXCEPTION 'same system DLQ entry created more than one logical replay Job';
  END IF;

  DELETE FROM jobs.system_jobs WHERE id = v_child;
  DELETE FROM dlq.system_entries WHERE id = v_dlq;
  DELETE FROM jobs.system_jobs WHERE id = v_source;
END
$system_lineage$;
