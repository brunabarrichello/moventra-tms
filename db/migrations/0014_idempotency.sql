-- Moventra TMS — Migration 0014: Idempotency
-- Phase 022 — Idempotência
-- Tenant-scoped transactional idempotency records. No Outbox/Messaging/Jobs are introduced here.

CREATE SCHEMA IF NOT EXISTS idempotency;

CREATE TABLE idempotency.records (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    operation_key TEXT NOT NULL,
    key_hash CHAR(64) NOT NULL,
    key_hash_version SMALLINT NOT NULL DEFAULT 1,
    fingerprint CHAR(64) NOT NULL,
    fingerprint_version SMALLINT NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'PROCESSING',
    response_status INTEGER NULL,
    response_media_type TEXT NULL,
    response_body JSONB NULL,
    response_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    completed_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_idempotency_records PRIMARY KEY (id),
    CONSTRAINT uq_idempotency_records_tenant_operation_key
        UNIQUE (tenant_id, operation_key, key_hash),
    CONSTRAINT fk_idempotency_records_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_idempotency_records_operation_key CHECK (
        operation_key = lower(operation_key)
        AND char_length(operation_key) BETWEEN 3 AND 160
        AND operation_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$'
    ),
    CONSTRAINT ck_idempotency_records_key_hash CHECK (
        key_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_idempotency_records_key_hash_version CHECK (
        key_hash_version BETWEEN 1 AND 32767
    ),
    CONSTRAINT ck_idempotency_records_fingerprint CHECK (
        fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_idempotency_records_fingerprint_version CHECK (
        fingerprint_version BETWEEN 1 AND 32767
    ),
    CONSTRAINT ck_idempotency_records_state CHECK (
        state IN ('PROCESSING','COMPLETED')
    ),
    CONSTRAINT ck_idempotency_records_response_status CHECK (
        response_status IS NULL OR response_status BETWEEN 100 AND 599
    ),
    CONSTRAINT ck_idempotency_records_response_media_type CHECK (
        response_media_type IS NULL
        OR (
            response_media_type = btrim(response_media_type)
            AND char_length(response_media_type) BETWEEN 1 AND 160
            AND response_media_type !~ '[\r\n]'
        )
    ),
    CONSTRAINT ck_idempotency_records_response_headers CHECK (
        jsonb_typeof(response_headers) = 'object'
        AND octet_length(response_headers::text) <= 8192
    ),
    CONSTRAINT ck_idempotency_records_response_body_size CHECK (
        response_body IS NULL OR octet_length(response_body::text) <= 65536
    ),
    CONSTRAINT ck_idempotency_records_lifecycle CHECK (
        (
            state = 'PROCESSING'
            AND completed_at IS NULL
            AND response_status IS NULL
            AND response_media_type IS NULL
            AND response_body IS NULL
            AND response_headers = '{}'::jsonb
        )
        OR (
            state = 'COMPLETED'
            AND completed_at IS NOT NULL
            AND response_status BETWEEN 100 AND 599
            AND response_media_type IS NOT NULL
            AND completed_at >= created_at
        )
    ),
    CONSTRAINT ck_idempotency_records_expiry CHECK (
        expires_at > created_at
    )
);

CREATE INDEX ix_idempotency_records_expires_at
    ON idempotency.records(expires_at);
CREATE INDEX ix_idempotency_records_tenant_state_expiry
    ON idempotency.records(tenant_id, state, expires_at);

ALTER TABLE idempotency.records ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_idempotency_records
    ON idempotency.records
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

COMMENT ON SCHEMA idempotency IS
    'Moventra transactional idempotency infrastructure. It does not replace authorization, Audit or Transactional Outbox.';
COMMENT ON TABLE idempotency.records IS
    'Tenant-scoped idempotency claims and replay results. Claim, PostgreSQL business mutation and stored result should commit atomically.';
COMMENT ON COLUMN idempotency.records.operation_key IS
    'Application-controlled logical operation namespace; never free-form client input.';
COMMENT ON COLUMN idempotency.records.key_hash IS
    'SHA-256 of the normalized Idempotency-Key. The plaintext key must not be persisted.';
COMMENT ON COLUMN idempotency.records.fingerprint IS
    'Versioned SHA-256 of canonical semantic request input; excludes credentials and transport-only correlation data.';
COMMENT ON COLUMN idempotency.records.expires_at IS
    'Retention/replay horizon metadata. Physical cleanup is deferred to the future Jobs framework and must not weaken domain uniqueness.';