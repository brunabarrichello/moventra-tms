-- Moventra TMS — Migration 0015: Transactional Outbox
-- Phase 023 — Transactional Outbox
-- Provider-neutral tenant-scoped event persistence. No broker, scheduler or DLQ is introduced here.

CREATE SCHEMA IF NOT EXISTS outbox;

CREATE TABLE outbox.events (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NULL,
    event_type TEXT NOT NULL,
    schema_version SMALLINT NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    published_at TIMESTAMPTZ NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ NULL,
    claim_token UUID NULL,
    claimed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_outbox_events PRIMARY KEY (id),
    CONSTRAINT fk_outbox_events_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_outbox_events_aggregate_type CHECK (
        aggregate_type = lower(aggregate_type)
        AND char_length(aggregate_type) BETWEEN 2 AND 64
        AND aggregate_type ~ '^[a-z][a-z0-9_]{1,63}$'
    ),
    CONSTRAINT ck_outbox_events_event_type CHECK (
        event_type = lower(event_type)
        AND char_length(event_type) BETWEEN 3 AND 160
        AND event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$'
    ),
    CONSTRAINT ck_outbox_events_schema_version CHECK (
        schema_version BETWEEN 1 AND 32767
    ),
    CONSTRAINT ck_outbox_events_payload CHECK (
        jsonb_typeof(payload) = 'object'
        AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT ck_outbox_events_metadata CHECK (
        jsonb_typeof(metadata) = 'object'
        AND octet_length(metadata::text) <= 8192
    ),
    CONSTRAINT ck_outbox_events_dedupe_key CHECK (
        dedupe_key IS NULL
        OR (
            dedupe_key = btrim(dedupe_key)
            AND char_length(dedupe_key) BETWEEN 1 AND 160
            AND dedupe_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        )
    ),
    CONSTRAINT ck_outbox_events_attempt_count CHECK (
        attempt_count >= 0
    ),
    CONSTRAINT ck_outbox_events_claim_pair CHECK (
        (claim_token IS NULL AND claimed_at IS NULL)
        OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    ),
    CONSTRAINT ck_outbox_events_attempt_lifecycle CHECK (
        (attempt_count = 0 AND last_attempt_at IS NULL AND claim_token IS NULL)
        OR (attempt_count > 0 AND last_attempt_at IS NOT NULL)
    ),
    CONSTRAINT ck_outbox_events_temporal CHECK (
        available_at >= occurred_at
        AND (last_attempt_at IS NULL OR last_attempt_at >= occurred_at)
        AND (claimed_at IS NULL OR claimed_at >= occurred_at)
        AND (published_at IS NULL OR published_at >= occurred_at)
    ),
    CONSTRAINT ck_outbox_events_published_not_claimed CHECK (
        (published_at IS NULL OR (claim_token IS NULL AND claimed_at IS NULL))
    )
);

CREATE INDEX ix_outbox_events_pending_eligibility
    ON outbox.events (available_at, claimed_at, id)
    WHERE published_at IS NULL;
CREATE INDEX ix_outbox_events_tenant_id
    ON outbox.events (tenant_id, id);
CREATE INDEX ix_outbox_events_retention
    ON outbox.events (published_at, created_at)
    WHERE published_at IS NOT NULL;

ALTER TABLE outbox.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_outbox_events
    ON outbox.events
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

COMMENT ON SCHEMA outbox IS
    'Moventra provider-neutral Transactional Outbox. Persistence only; broker, recurring dispatcher and DLQ belong to later phases.';
COMMENT ON TABLE outbox.events IS
    'Tenant-scoped integration facts persisted atomically with business state and Audit inside the same PostgreSQL transaction.';
COMMENT ON COLUMN outbox.events.event_type IS
    'Stable application-controlled integration event type; never free-form client input.';
COMMENT ON COLUMN outbox.events.payload IS
    'Minimized versioned integration payload. Credentials, raw request bodies and unnecessary personal data are forbidden.';
COMMENT ON COLUMN outbox.events.metadata IS
    'Allowlisted technical metadata only. Arbitrary headers, tokens, DSNs and plaintext Idempotency-Key values are forbidden.';
COMMENT ON COLUMN outbox.events.dedupe_key IS
    'Optional domain-provided logical dedupe hint. No generic uniqueness constraint is imposed.';