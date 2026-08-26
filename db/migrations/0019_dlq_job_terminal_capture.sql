-- Moventra TMS — Migration 0019: DLQ terminal Job capture
-- Phase 026 — DLQ / Batch 3
--
-- Guarantees that every transition into jobs.failed_terminal creates the matching
-- provider-neutral durable DLQ record in the SAME PostgreSQL transaction.
--
-- Security invariants:
--   * tenant identity comes only from jobs.jobs.tenant_id;
--   * system jobs are written only to dlq.system_entries;
--   * the automatic snapshot never copies the Job payload or arbitrary provider errors;
--   * the trigger function is SECURITY DEFINER and PUBLIC cannot execute it directly;
--   * duplicate transitions are deduplicated by the existing source uniqueness contract.

CREATE OR REPLACE FUNCTION dlq.capture_terminal_tenant_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_failure_code TEXT;
    v_failure_class TEXT;
    v_snapshot JSONB;
    v_metadata JSONB;
BEGIN
    IF NEW.status <> 'failed_terminal'
       OR OLD.status = 'failed_terminal' THEN
        RETURN NEW;
    END IF;

    v_failure_code := CASE
        WHEN NEW.last_error_code IS NOT NULL
         AND NEW.last_error_code = upper(NEW.last_error_code)
         AND char_length(NEW.last_error_code) BETWEEN 3 AND 160
         AND NEW.last_error_code ~ '^[A-Z][A-Z0-9_]{2,159}$'
        THEN NEW.last_error_code
        ELSE 'MVT_JOB_FAILED_TERMINAL'
    END;

    v_failure_class := CASE
        WHEN NEW.last_error_class IS NOT NULL
         AND NEW.last_error_class = lower(NEW.last_error_class)
         AND char_length(NEW.last_error_class) BETWEEN 2 AND 80
         AND NEW.last_error_class ~ '^[a-z][a-z0-9_-]{1,79}$'
        THEN NEW.last_error_class
        ELSE 'terminal'
    END;

    -- Do not duplicate the Job payload into DLQ automatically. Reprocessing must resolve
    -- the authoritative source Job by source_id through a narrow governed capability.
    -- This keeps terminal capture safe even when future Job payloads contain personal or
    -- provider-sensitive data.
    v_snapshot := jsonb_build_object(
        'jobId', NEW.id,
        'tenantId', NEW.tenant_id,
        'jobType', NEW.job_type,
        'schemaVersion', NEW.schema_version,
        'attemptCount', NEW.attempt_count,
        'maxAttempts', NEW.max_attempts,
        'payload', jsonb_build_object('omitted', 'authoritative_job_reference')
    );

    v_metadata := jsonb_strip_nulls(jsonb_build_object(
        'origin', 'jobs.failed_terminal',
        'completedAt', NEW.completed_at,
        'scheduleKey', NEW.schedule_key
    ));

    INSERT INTO dlq.entries (
        tenant_id,
        source_kind,
        source_id,
        source_type,
        source_schema_version,
        failure_code,
        failure_class,
        snapshot,
        metadata,
        max_reprocess_attempts
    ) VALUES (
        NEW.tenant_id,
        'job',
        NEW.id,
        NEW.job_type,
        NEW.schema_version,
        v_failure_code,
        v_failure_class,
        v_snapshot,
        v_metadata,
        5
    )
    ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING;

    RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION dlq.capture_terminal_system_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_failure_code TEXT;
    v_failure_class TEXT;
    v_snapshot JSONB;
    v_metadata JSONB;
BEGIN
    IF NEW.status <> 'failed_terminal'
       OR OLD.status = 'failed_terminal' THEN
        RETURN NEW;
    END IF;

    v_failure_code := CASE
        WHEN NEW.last_error_code IS NOT NULL
         AND NEW.last_error_code = upper(NEW.last_error_code)
         AND char_length(NEW.last_error_code) BETWEEN 3 AND 160
         AND NEW.last_error_code ~ '^[A-Z][A-Z0-9_]{2,159}$'
        THEN NEW.last_error_code
        ELSE 'MVT_JOB_FAILED_TERMINAL'
    END;

    v_failure_class := CASE
        WHEN NEW.last_error_class IS NOT NULL
         AND NEW.last_error_class = lower(NEW.last_error_class)
         AND char_length(NEW.last_error_class) BETWEEN 2 AND 80
         AND NEW.last_error_class ~ '^[a-z][a-z0-9_-]{1,79}$'
        THEN NEW.last_error_class
        ELSE 'terminal'
    END;

    v_snapshot := jsonb_build_object(
        'jobId', NEW.id,
        'jobType', NEW.job_type,
        'schemaVersion', NEW.schema_version,
        'attemptCount', NEW.attempt_count,
        'maxAttempts', NEW.max_attempts,
        'payload', jsonb_build_object('omitted', 'authoritative_job_reference')
    );

    v_metadata := jsonb_strip_nulls(jsonb_build_object(
        'origin', 'jobs.failed_terminal',
        'completedAt', NEW.completed_at,
        'scheduleKey', NEW.schedule_key
    ));

    INSERT INTO dlq.system_entries (
        source_kind,
        source_id,
        source_type,
        source_schema_version,
        failure_code,
        failure_class,
        snapshot,
        metadata,
        max_reprocess_attempts
    ) VALUES (
        'job',
        NEW.id,
        NEW.job_type,
        NEW.schema_version,
        v_failure_code,
        v_failure_class,
        v_snapshot,
        v_metadata,
        5
    )
    ON CONFLICT (source_kind, source_id) DO NOTHING;

    RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION dlq.capture_terminal_tenant_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION dlq.capture_terminal_system_job() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_jobs_jobs_capture_terminal_dlq ON jobs.jobs;
CREATE TRIGGER trg_jobs_jobs_capture_terminal_dlq
AFTER UPDATE OF status ON jobs.jobs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'failed_terminal')
EXECUTE FUNCTION dlq.capture_terminal_tenant_job();

DROP TRIGGER IF EXISTS trg_jobs_system_jobs_capture_terminal_dlq ON jobs.system_jobs;
CREATE TRIGGER trg_jobs_system_jobs_capture_terminal_dlq
AFTER UPDATE OF status ON jobs.system_jobs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'failed_terminal')
EXECUTE FUNCTION dlq.capture_terminal_system_job();

COMMENT ON FUNCTION dlq.capture_terminal_tenant_job() IS
    'Phase-026 atomic tenant Job terminal-capture trigger. Derives tenant/source from the authoritative Job and persists only a minimized DLQ snapshot.';
COMMENT ON FUNCTION dlq.capture_terminal_system_job() IS
    'Phase-026 atomic system Job terminal-capture trigger. Persists platform Job failure metadata to dlq.system_entries without copying arbitrary payloads.';
COMMENT ON TRIGGER trg_jobs_jobs_capture_terminal_dlq ON jobs.jobs IS
    'Atomically quarantines each tenant Job when status first transitions to failed_terminal.';
COMMENT ON TRIGGER trg_jobs_system_jobs_capture_terminal_dlq ON jobs.system_jobs IS
    'Atomically quarantines each system Job when status first transitions to failed_terminal.';
