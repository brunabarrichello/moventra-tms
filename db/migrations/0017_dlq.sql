-- Moventra TMS — Migration 0017: DLQ / Quarantine
-- Phase 026 — DLQ
--
-- Invariants:
--   * tenant-scoped entries live in dlq.entries with tenant_id UUID NOT NULL + RLS;
--   * platform/system entries live in dlq.system_entries and never use tenant_id = NULL;
--   * payload/snapshot contract is bounded JSON; application code performs allowlisting/redaction;
--   * status changes are state-machine transitions, not free-form CRUD;
--   * reprocessing is lease/token owned and bounded by max_reprocess_attempts.

CREATE SCHEMA IF NOT EXISTS dlq;

CREATE TABLE dlq.entries (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    source_kind TEXT NOT NULL,
    source_id UUID NOT NULL,
    source_type TEXT NOT NULL,
    source_schema_version SMALLINT NOT NULL DEFAULT 1,
    failure_code TEXT NOT NULL,
    failure_class TEXT NOT NULL,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'quarantined',
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    reprocess_count INTEGER NOT NULL DEFAULT 0,
    max_reprocess_attempts SMALLINT NOT NULL DEFAULT 5,
    next_reprocess_at TIMESTAMPTZ NULL,
    reprocess_claim_token UUID NULL,
    reprocess_claimed_at TIMESTAMPTZ NULL,
    reprocess_claim_expires_at TIMESTAMPTZ NULL,
    last_reprocess_at TIMESTAMPTZ NULL,
    last_failure_code TEXT NULL,
    resolved_at TIMESTAMPTZ NULL,
    resolved_by_membership_id UUID NULL,
    resolution_code TEXT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_dlq_entries PRIMARY KEY (id),
    CONSTRAINT uq_dlq_entries_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_dlq_entries_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_dlq_entries_resolved_membership FOREIGN KEY (tenant_id, resolved_by_membership_id)
        REFERENCES identity.memberships(tenant_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_dlq_entries_source_kind CHECK (source_kind IN ('message', 'job')),
    CONSTRAINT ck_dlq_entries_source_type CHECK (
        source_type = lower(source_type)
        AND char_length(source_type) BETWEEN 3 AND 160
        AND source_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$'
    ),
    CONSTRAINT ck_dlq_entries_source_schema_version CHECK (source_schema_version BETWEEN 1 AND 32767),
    CONSTRAINT ck_dlq_entries_failure_code CHECK (
        failure_code = upper(failure_code)
        AND char_length(failure_code) BETWEEN 3 AND 160
        AND failure_code ~ '^[A-Z][A-Z0-9_]{2,159}$'
    ),
    CONSTRAINT ck_dlq_entries_failure_class CHECK (
        failure_class = lower(failure_class)
        AND char_length(failure_class) BETWEEN 2 AND 80
        AND failure_class ~ '^[a-z][a-z0-9_-]{1,79}$'
    ),
    CONSTRAINT ck_dlq_entries_snapshot CHECK (
        jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 65536
    ),
    CONSTRAINT ck_dlq_entries_metadata CHECK (
        jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192
    ),
    CONSTRAINT ck_dlq_entries_status CHECK (
        status IN ('quarantined', 'reprocess_pending', 'reprocessing', 'resolved', 'discarded', 'exhausted')
    ),
    CONSTRAINT ck_dlq_entries_reprocess_count CHECK (
        reprocess_count >= 0
        AND max_reprocess_attempts BETWEEN 1 AND 25
        AND reprocess_count <= max_reprocess_attempts
    ),
    CONSTRAINT ck_dlq_entries_claim_lifecycle CHECK (
        (status = 'reprocessing'
            AND reprocess_claim_token IS NOT NULL
            AND reprocess_claimed_at IS NOT NULL
            AND reprocess_claim_expires_at IS NOT NULL)
        OR (status <> 'reprocessing'
            AND reprocess_claim_token IS NULL
            AND reprocess_claimed_at IS NULL
            AND reprocess_claim_expires_at IS NULL)
    ),
    CONSTRAINT ck_dlq_entries_claim_temporal CHECK (
        reprocess_claim_expires_at IS NULL
        OR reprocess_claim_expires_at > reprocess_claimed_at
    ),
    CONSTRAINT ck_dlq_entries_resolution_lifecycle CHECK (
        (status IN ('resolved', 'discarded')
            AND resolved_at IS NOT NULL
            AND resolution_code IS NOT NULL)
        OR (status NOT IN ('resolved', 'discarded')
            AND resolved_at IS NULL
            AND resolved_by_membership_id IS NULL
            AND resolution_code IS NULL)
    ),
    CONSTRAINT ck_dlq_entries_resolution_code CHECK (
        resolution_code IS NULL
        OR (
            resolution_code = lower(resolution_code)
            AND char_length(resolution_code) BETWEEN 2 AND 80
            AND resolution_code ~ '^[a-z][a-z0-9_.-]{1,79}$'
        )
    ),
    CONSTRAINT ck_dlq_entries_last_failure_code CHECK (
        last_failure_code IS NULL
        OR (
            last_failure_code = upper(last_failure_code)
            AND char_length(last_failure_code) BETWEEN 3 AND 160
            AND last_failure_code ~ '^[A-Z][A-Z0-9_]{2,159}$'
        )
    ),
    CONSTRAINT ck_dlq_entries_version CHECK (version >= 1),
    CONSTRAINT ck_dlq_entries_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX ux_dlq_entries_source
    ON dlq.entries (tenant_id, source_kind, source_id);
CREATE INDEX ix_dlq_entries_queue
    ON dlq.entries (tenant_id, status, next_reprocess_at, quarantined_at, id);
CREATE INDEX ix_dlq_entries_source_type
    ON dlq.entries (tenant_id, source_kind, source_type, status, quarantined_at DESC);
CREATE INDEX ix_dlq_entries_expired_claim
    ON dlq.entries (tenant_id, reprocess_claim_expires_at, id)
    WHERE status = 'reprocessing';

ALTER TABLE dlq.entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dlq_entries
    ON dlq.entries
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

-- Platform/system failures are physically separated from tenant data. This table is
-- intentionally not RLS/tenant aware and receives no normal application-runtime access.
CREATE TABLE dlq.system_entries (
    id UUID NOT NULL DEFAULT uuidv7(),
    source_kind TEXT NOT NULL,
    source_id UUID NOT NULL,
    source_type TEXT NOT NULL,
    source_schema_version SMALLINT NOT NULL DEFAULT 1,
    failure_code TEXT NOT NULL,
    failure_class TEXT NOT NULL,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'quarantined',
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    reprocess_count INTEGER NOT NULL DEFAULT 0,
    max_reprocess_attempts SMALLINT NOT NULL DEFAULT 5,
    next_reprocess_at TIMESTAMPTZ NULL,
    reprocess_claim_token UUID NULL,
    reprocess_claimed_at TIMESTAMPTZ NULL,
    reprocess_claim_expires_at TIMESTAMPTZ NULL,
    last_reprocess_at TIMESTAMPTZ NULL,
    last_failure_code TEXT NULL,
    resolved_at TIMESTAMPTZ NULL,
    resolved_by_user_id UUID NULL,
    resolution_code TEXT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_dlq_system_entries PRIMARY KEY (id),
    CONSTRAINT fk_dlq_system_entries_resolved_user FOREIGN KEY (resolved_by_user_id)
        REFERENCES identity.users(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_dlq_system_entries_source_kind CHECK (source_kind IN ('message', 'job')),
    CONSTRAINT ck_dlq_system_entries_source_type CHECK (
        source_type = lower(source_type)
        AND char_length(source_type) BETWEEN 3 AND 160
        AND source_type ~ '^system\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,6}$'
    ),
    CONSTRAINT ck_dlq_system_entries_source_schema_version CHECK (source_schema_version BETWEEN 1 AND 32767),
    CONSTRAINT ck_dlq_system_entries_failure_code CHECK (
        failure_code = upper(failure_code)
        AND char_length(failure_code) BETWEEN 3 AND 160
        AND failure_code ~ '^[A-Z][A-Z0-9_]{2,159}$'
    ),
    CONSTRAINT ck_dlq_system_entries_failure_class CHECK (
        failure_class = lower(failure_class)
        AND char_length(failure_class) BETWEEN 2 AND 80
        AND failure_class ~ '^[a-z][a-z0-9_-]{1,79}$'
    ),
    CONSTRAINT ck_dlq_system_entries_snapshot CHECK (
        jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 65536
    ),
    CONSTRAINT ck_dlq_system_entries_metadata CHECK (
        jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192
    ),
    CONSTRAINT ck_dlq_system_entries_status CHECK (
        status IN ('quarantined', 'reprocess_pending', 'reprocessing', 'resolved', 'discarded', 'exhausted')
    ),
    CONSTRAINT ck_dlq_system_entries_reprocess_count CHECK (
        reprocess_count >= 0
        AND max_reprocess_attempts BETWEEN 1 AND 25
        AND reprocess_count <= max_reprocess_attempts
    ),
    CONSTRAINT ck_dlq_system_entries_claim_lifecycle CHECK (
        (status = 'reprocessing'
            AND reprocess_claim_token IS NOT NULL
            AND reprocess_claimed_at IS NOT NULL
            AND reprocess_claim_expires_at IS NOT NULL)
        OR (status <> 'reprocessing'
            AND reprocess_claim_token IS NULL
            AND reprocess_claimed_at IS NULL
            AND reprocess_claim_expires_at IS NULL)
    ),
    CONSTRAINT ck_dlq_system_entries_claim_temporal CHECK (
        reprocess_claim_expires_at IS NULL
        OR reprocess_claim_expires_at > reprocess_claimed_at
    ),
    CONSTRAINT ck_dlq_system_entries_resolution_lifecycle CHECK (
        (status IN ('resolved', 'discarded')
            AND resolved_at IS NOT NULL
            AND resolution_code IS NOT NULL)
        OR (status NOT IN ('resolved', 'discarded')
            AND resolved_at IS NULL
            AND resolved_by_user_id IS NULL
            AND resolution_code IS NULL)
    ),
    CONSTRAINT ck_dlq_system_entries_resolution_code CHECK (
        resolution_code IS NULL
        OR (
            resolution_code = lower(resolution_code)
            AND char_length(resolution_code) BETWEEN 2 AND 80
            AND resolution_code ~ '^[a-z][a-z0-9_.-]{1,79}$'
        )
    ),
    CONSTRAINT ck_dlq_system_entries_last_failure_code CHECK (
        last_failure_code IS NULL
        OR (
            last_failure_code = upper(last_failure_code)
            AND char_length(last_failure_code) BETWEEN 3 AND 160
            AND last_failure_code ~ '^[A-Z][A-Z0-9_]{2,159}$'
        )
    ),
    CONSTRAINT ck_dlq_system_entries_version CHECK (version >= 1),
    CONSTRAINT ck_dlq_system_entries_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX ux_dlq_system_entries_source
    ON dlq.system_entries (source_kind, source_id);
CREATE INDEX ix_dlq_system_entries_queue
    ON dlq.system_entries (status, next_reprocess_at, quarantined_at, id);
CREATE INDEX ix_dlq_system_entries_source_type
    ON dlq.system_entries (source_kind, source_type, status, quarantined_at DESC);
CREATE INDEX ix_dlq_system_entries_expired_claim
    ON dlq.system_entries (reprocess_claim_expires_at, id)
    WHERE status = 'reprocessing';

INSERT INTO security.permissions (code, description, status)
VALUES
    ('dlq.read', 'Read tenant-scoped dead-letter quarantine metadata', 'ACTIVE'),
    ('dlq.reprocess', 'Request controlled reprocessing of a tenant-scoped dead-letter entry', 'ACTIVE'),
    ('dlq.resolve', 'Resolve a tenant-scoped dead-letter entry without payload mutation', 'ACTIVE'),
    ('dlq.discard', 'Discard a tenant-scoped dead-letter entry through a governed terminal decision', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

COMMENT ON SCHEMA dlq IS
    'Provider-neutral durable dead-letter quarantine and governed reprocessing for Moventra phase 026.';
COMMENT ON TABLE dlq.entries IS
    'Tenant-scoped durable DLQ entries. tenant_id is mandatory, protected by RLS, and never inferred from untrusted payload metadata.';
COMMENT ON TABLE dlq.system_entries IS
    'Platform/system DLQ entries physically separated from tenant data. Normal tenant application runtime has no access.';
COMMENT ON COLUMN dlq.entries.snapshot IS
    'Bounded allowlisted/redacted source snapshot. Application code must reject or redact secrets before persistence.';
COMMENT ON COLUMN dlq.system_entries.snapshot IS
    'Bounded allowlisted/redacted system source snapshot. Never a raw provider error/payload dump.';
