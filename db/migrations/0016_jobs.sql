-- Moventra TMS — Migration 0016: Durable Jobs
-- Phase 025 — Jobs, scheduler and Outbox Dispatcher
--
-- Data-convention invariant preserved:
--   * jobs.jobs is tenant-scoped and therefore tenant_id is UUID NOT NULL;
--   * jobs.system_jobs is technical/global and therefore has no tenant_id.
-- A nullable tenant_id is deliberately avoided instead of weakening the phase-007 tenancy contract.

CREATE SCHEMA IF NOT EXISTS jobs;

CREATE TABLE jobs.jobs (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    job_type TEXT NOT NULL,
    schema_version SMALLINT NOT NULL DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'scheduled',
    priority SMALLINT NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 10,
    lease_token UUID NULL,
    leased_at TIMESTAMPTZ NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    last_heartbeat_at TIMESTAMPTZ NULL,
    last_error_code TEXT NULL,
    last_error_class TEXT NULL,
    schedule_key TEXT NULL,
    recurrence_interval_ms BIGINT NULL,
    last_completed_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_jobs_jobs PRIMARY KEY (id),
    CONSTRAINT fk_jobs_jobs_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_jobs_jobs_type CHECK (
        job_type = lower(job_type)
        AND char_length(job_type) BETWEEN 3 AND 160
        AND job_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$'
    ),
    CONSTRAINT ck_jobs_jobs_schema_version CHECK (schema_version BETWEEN 1 AND 32767),
    CONSTRAINT ck_jobs_jobs_payload CHECK (
        jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT ck_jobs_jobs_metadata CHECK (
        jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192
    ),
    CONSTRAINT ck_jobs_jobs_status CHECK (
        status IN ('scheduled', 'running', 'retry_scheduled', 'succeeded', 'failed_terminal', 'cancelled')
    ),
    CONSTRAINT ck_jobs_jobs_priority CHECK (priority BETWEEN -100 AND 100),
    CONSTRAINT ck_jobs_jobs_attempts CHECK (
        attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_jobs_jobs_lease_lifecycle CHECK (
        (status = 'running'
            AND lease_token IS NOT NULL
            AND leased_at IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND last_heartbeat_at IS NOT NULL)
        OR (status <> 'running'
            AND lease_token IS NULL
            AND leased_at IS NULL
            AND lease_expires_at IS NULL
            AND last_heartbeat_at IS NULL)
    ),
    CONSTRAINT ck_jobs_jobs_lease_temporal CHECK (
        lease_expires_at IS NULL OR lease_expires_at > leased_at
    ),
    CONSTRAINT ck_jobs_jobs_schedule_key CHECK (
        schedule_key IS NULL
        OR (
            schedule_key = btrim(schedule_key)
            AND char_length(schedule_key) BETWEEN 1 AND 160
            AND schedule_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        )
    ),
    CONSTRAINT ck_jobs_jobs_recurrence CHECK (
        recurrence_interval_ms IS NULL OR recurrence_interval_ms BETWEEN 1000 AND 86400000
    ),
    CONSTRAINT ck_jobs_jobs_completion CHECK (
        (status IN ('succeeded', 'failed_terminal') AND completed_at IS NOT NULL)
        OR (status NOT IN ('succeeded', 'failed_terminal') AND completed_at IS NULL)
    ),
    CONSTRAINT ck_jobs_jobs_cancellation CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL)
        OR (status <> 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE INDEX ix_jobs_jobs_eligibility
    ON jobs.jobs (tenant_id, status, available_at, priority DESC, created_at, id)
    WHERE status IN ('scheduled', 'retry_scheduled', 'running');
CREATE INDEX ix_jobs_jobs_expired_lease
    ON jobs.jobs (tenant_id, lease_expires_at, id)
    WHERE status = 'running';
CREATE INDEX ix_jobs_jobs_type_status
    ON jobs.jobs (tenant_id, job_type, status, available_at);
CREATE UNIQUE INDEX ux_jobs_jobs_active_schedule_key
    ON jobs.jobs (tenant_id, schedule_key)
    WHERE schedule_key IS NOT NULL
      AND status IN ('scheduled', 'running', 'retry_scheduled');

ALTER TABLE jobs.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_jobs_jobs
    ON jobs.jobs
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

-- System jobs are intentionally isolated in a technical/global table rather than
-- represented by tenant_id = NULL in a mixed-scope table. This preserves the canonical
-- tenant_id NOT NULL invariant and makes system ownership explicit in the physical model.
CREATE TABLE jobs.system_jobs (
    id UUID NOT NULL DEFAULT uuidv7(),
    job_type TEXT NOT NULL,
    schema_version SMALLINT NOT NULL DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'scheduled',
    priority SMALLINT NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 10,
    lease_token UUID NULL,
    leased_at TIMESTAMPTZ NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    last_heartbeat_at TIMESTAMPTZ NULL,
    last_error_code TEXT NULL,
    last_error_class TEXT NULL,
    schedule_key TEXT NULL,
    recurrence_interval_ms BIGINT NULL,
    last_completed_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_jobs_system_jobs PRIMARY KEY (id),
    CONSTRAINT ck_jobs_system_jobs_type CHECK (
        job_type = lower(job_type)
        AND char_length(job_type) BETWEEN 3 AND 160
        AND job_type ~ '^system\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,6}$'
    ),
    CONSTRAINT ck_jobs_system_jobs_schema_version CHECK (schema_version BETWEEN 1 AND 32767),
    CONSTRAINT ck_jobs_system_jobs_payload CHECK (
        jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT ck_jobs_system_jobs_metadata CHECK (
        jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192
    ),
    CONSTRAINT ck_jobs_system_jobs_status CHECK (
        status IN ('scheduled', 'running', 'retry_scheduled', 'succeeded', 'failed_terminal')
    ),
    CONSTRAINT ck_jobs_system_jobs_priority CHECK (priority BETWEEN -100 AND 100),
    CONSTRAINT ck_jobs_system_jobs_attempts CHECK (
        attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_jobs_system_jobs_lease_lifecycle CHECK (
        (status = 'running'
            AND lease_token IS NOT NULL
            AND leased_at IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND last_heartbeat_at IS NOT NULL)
        OR (status <> 'running'
            AND lease_token IS NULL
            AND leased_at IS NULL
            AND lease_expires_at IS NULL
            AND last_heartbeat_at IS NULL)
    ),
    CONSTRAINT ck_jobs_system_jobs_lease_temporal CHECK (
        lease_expires_at IS NULL OR lease_expires_at > leased_at
    ),
    CONSTRAINT ck_jobs_system_jobs_schedule_key CHECK (
        schedule_key IS NULL
        OR (
            schedule_key = btrim(schedule_key)
            AND char_length(schedule_key) BETWEEN 1 AND 160
            AND schedule_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        )
    ),
    CONSTRAINT ck_jobs_system_jobs_recurrence CHECK (
        recurrence_interval_ms IS NULL OR recurrence_interval_ms BETWEEN 1000 AND 86400000
    ),
    CONSTRAINT ck_jobs_system_jobs_completion CHECK (
        (status IN ('succeeded', 'failed_terminal') AND completed_at IS NOT NULL)
        OR (status NOT IN ('succeeded', 'failed_terminal') AND completed_at IS NULL)
    )
);

CREATE INDEX ix_jobs_system_jobs_eligibility
    ON jobs.system_jobs (status, available_at, priority DESC, created_at, id)
    WHERE status IN ('scheduled', 'retry_scheduled', 'running');
CREATE INDEX ix_jobs_system_jobs_expired_lease
    ON jobs.system_jobs (lease_expires_at, id)
    WHERE status = 'running';
CREATE INDEX ix_jobs_system_jobs_type_status
    ON jobs.system_jobs (job_type, status, available_at);
CREATE UNIQUE INDEX ux_jobs_system_jobs_active_schedule_key
    ON jobs.system_jobs (schedule_key)
    WHERE schedule_key IS NOT NULL
      AND status IN ('scheduled', 'running', 'retry_scheduled');

-- The first system job is infrastructure-owned and created by migration, not by a tenant/API.
INSERT INTO jobs.system_jobs (
    job_type,
    schema_version,
    payload,
    metadata,
    status,
    priority,
    max_attempts,
    schedule_key,
    recurrence_interval_ms
) VALUES (
    'system.outbox_dispatch',
    1,
    '{}'::jsonb,
    '{}'::jsonb,
    'scheduled',
    100,
    10,
    'system.outbox_dispatch',
    1000
);

-- Narrow cross-tenant capability for the platform Outbox Dispatcher. The runtime role
-- remains NOBYPASSRLS and receives EXECUTE only through db/runtime/runtime-access.sql.
CREATE OR REPLACE FUNCTION outbox.claim_system_batch(
    p_limit INTEGER,
    p_claim_ttl_ms BIGINT,
    p_claim_token UUID
)
RETURNS SETOF outbox.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION 'invalid outbox system claim limit' USING ERRCODE = '22023';
    END IF;
    IF p_claim_ttl_ms < 1000 OR p_claim_ttl_ms > 3600000 THEN
        RAISE EXCEPTION 'invalid outbox system claim ttl' USING ERRCODE = '22023';
    END IF;
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'outbox system claim token is required' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH eligible AS (
        SELECT event.id
          FROM outbox.events AS event
         WHERE event.published_at IS NULL
           AND event.available_at <= clock_timestamp()
           AND (
               event.claim_token IS NULL
               OR event.claimed_at <= clock_timestamp() - (p_claim_ttl_ms * interval '1 millisecond')
           )
         ORDER BY event.available_at, event.occurred_at, event.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_limit
    )
    UPDATE outbox.events AS event
       SET claim_token = p_claim_token,
           claimed_at = clock_timestamp(),
           attempt_count = event.attempt_count + 1,
           last_attempt_at = clock_timestamp()
      FROM eligible
     WHERE event.id = eligible.id
    RETURNING event.*;
END
$function$;

CREATE OR REPLACE FUNCTION outbox.mark_system_published(
    p_event_id UUID,
    p_claim_token UUID
)
RETURNS SETOF outbox.events
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    UPDATE outbox.events AS event
       SET published_at = clock_timestamp(),
           claim_token = NULL,
           claimed_at = NULL
     WHERE event.id = p_event_id
       AND event.claim_token = p_claim_token
       AND event.published_at IS NULL
    RETURNING event.*;
$function$;

REVOKE ALL ON FUNCTION outbox.claim_system_batch(INTEGER, BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION outbox.mark_system_published(UUID, UUID) FROM PUBLIC;

COMMENT ON SCHEMA jobs IS
    'Moventra durable Jobs infrastructure. Administrative DLQ/reprocessing remains phase 026.';
COMMENT ON TABLE jobs.jobs IS
    'Durable tenant-scoped jobs. tenant_id is mandatory and protected by RLS.';
COMMENT ON TABLE jobs.system_jobs IS
    'Technical/global durable jobs owned by the platform; never tenant-owned.';
COMMENT ON FUNCTION outbox.claim_system_batch(INTEGER, BIGINT, UUID) IS
    'Narrow SECURITY DEFINER capability used only by the trusted system Outbox Dispatcher to claim across tenant RLS boundaries.';
