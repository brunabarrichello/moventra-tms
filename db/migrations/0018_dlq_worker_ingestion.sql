-- Moventra TMS — Migration 0018: DLQ Worker Ingestion Capability
-- Phase 026 — DLQ / Batch 2
-- Adds a narrow SECURITY DEFINER capability for the trusted worker to quarantine
-- dead-lettered Outbox messages without direct access to tenant-scoped DLQ/Outbox tables.

CREATE OR REPLACE FUNCTION dlq.quarantine_outbox_message(
    p_event_id UUID,
    p_failure_code TEXT,
    p_failure_class TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_max_reprocess_attempts SMALLINT DEFAULT 5
)
RETURNS SETOF dlq.entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_event outbox.events%ROWTYPE;
    v_snapshot JSONB;
BEGIN
    IF p_event_id IS NULL THEN
        RAISE EXCEPTION 'DLQ source event id is required' USING ERRCODE = '22023';
    END IF;
    IF p_failure_code IS NULL
       OR p_failure_code !~ '^[A-Z][A-Z0-9_]{2,159}$' THEN
        RAISE EXCEPTION 'invalid DLQ failure code' USING ERRCODE = '22023';
    END IF;
    IF p_failure_class IS NULL
       OR p_failure_class !~ '^[a-z][a-z0-9_-]{1,79}$' THEN
        RAISE EXCEPTION 'invalid DLQ failure class' USING ERRCODE = '22023';
    END IF;
    IF p_metadata IS NULL
       OR jsonb_typeof(p_metadata) <> 'object'
       OR octet_length(p_metadata::text) > 8192 THEN
        RAISE EXCEPTION 'invalid DLQ ingestion metadata' USING ERRCODE = '22023';
    END IF;
    IF p_max_reprocess_attempts < 1 OR p_max_reprocess_attempts > 25 THEN
        RAISE EXCEPTION 'invalid DLQ max reprocess attempts' USING ERRCODE = '22023';
    END IF;

    -- Tenant identity and source contract are resolved only from the authoritative
    -- Transactional Outbox row. Broker headers, x-death and dead-letter payload fields
    -- are never trusted to select a tenant.
    SELECT event.*
      INTO v_event
      FROM outbox.events AS event
     WHERE event.id = p_event_id
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Preserve bounded operational context from the authoritative source. Large payloads
    -- are represented by an explicit omission marker to stay below the DLQ snapshot cap.
    v_snapshot := jsonb_build_object(
        'messageId', v_event.id,
        'eventId', v_event.id,
        'tenantId', v_event.tenant_id,
        'eventType', v_event.event_type,
        'schemaVersion', v_event.schema_version,
        'occurredAt', v_event.occurred_at,
        'payload', CASE
            WHEN octet_length(v_event.payload::text) <= 60000 THEN v_event.payload
            ELSE jsonb_build_object('omitted', 'payload_too_large')
        END
    );

    RETURN QUERY
    WITH inserted AS (
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
            v_event.tenant_id,
            'message',
            v_event.id,
            v_event.event_type,
            v_event.schema_version,
            p_failure_code,
            p_failure_class,
            v_snapshot,
            p_metadata,
            p_max_reprocess_attempts
        )
        ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING
        RETURNING *
    )
    SELECT inserted.*
      FROM inserted
    UNION ALL
    SELECT existing.*
      FROM dlq.entries AS existing
     WHERE existing.tenant_id = v_event.tenant_id
       AND existing.source_kind = 'message'
       AND existing.source_id = v_event.id
       AND NOT EXISTS (SELECT 1 FROM inserted)
     LIMIT 1;
END
$function$;

REVOKE ALL ON FUNCTION dlq.quarantine_outbox_message(UUID, TEXT, TEXT, JSONB, SMALLINT) FROM PUBLIC;

COMMENT ON FUNCTION dlq.quarantine_outbox_message(UUID, TEXT, TEXT, JSONB, SMALLINT) IS
    'Phase-026 narrow worker capability. Derives tenant/source from authoritative Outbox state and idempotently quarantines a dead-lettered message without direct table grants.';
