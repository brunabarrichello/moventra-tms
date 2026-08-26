-- Moventra TMS — Validation 0017: DLQ / Quarantine
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_nullable TEXT;
    v_rls BOOLEAN;
    v_policy_count INTEGER;
    v_permission_count INTEGER;
BEGIN
    SELECT is_nullable
      INTO v_nullable
      FROM information_schema.columns
     WHERE table_schema = 'dlq'
       AND table_name = 'entries'
       AND column_name = 'tenant_id';

    IF v_nullable IS DISTINCT FROM 'NO' THEN
        RAISE EXCEPTION 'dlq.entries.tenant_id must be NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'dlq'
           AND table_name = 'system_entries'
           AND column_name = 'tenant_id'
    ) THEN
        RAISE EXCEPTION 'dlq.system_entries must not contain tenant_id';
    END IF;

    SELECT relrowsecurity
      INTO v_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'dlq'
       AND c.relname = 'entries';

    IF v_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'RLS must be enabled on dlq.entries';
    END IF;

    SELECT count(*)
      INTO v_policy_count
      FROM pg_policies
     WHERE schemaname = 'dlq'
       AND tablename = 'entries'
       AND policyname = 'tenant_isolation_dlq_entries';

    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION 'tenant_isolation_dlq_entries policy must exist exactly once';
    END IF;

    SELECT count(*)
      INTO v_permission_count
      FROM security.permissions
     WHERE code IN ('dlq.read', 'dlq.reprocess', 'dlq.resolve', 'dlq.discard')
       AND status = 'ACTIVE';

    IF v_permission_count <> 4 THEN
        RAISE EXCEPTION 'all four DLQ permissions must exist and be ACTIVE';
    END IF;
END
$$;

-- Tenant/system physical separation and deterministic dedupe constraints.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_indexes
         WHERE schemaname = 'dlq'
           AND tablename = 'entries'
           AND indexname = 'ux_dlq_entries_source'
    ) THEN
        RAISE EXCEPTION 'tenant DLQ source dedupe index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_indexes
         WHERE schemaname = 'dlq'
           AND tablename = 'system_entries'
           AND indexname = 'ux_dlq_system_entries_source'
    ) THEN
        RAISE EXCEPTION 'system DLQ source dedupe index is missing';
    END IF;
END
$$;

-- Constraints must reject mixed-scope/state corruption.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-7000-8000-000000000001';

DO $$
BEGIN
    BEGIN
        INSERT INTO dlq.system_entries (
            source_kind, source_id, source_type, failure_code, failure_class,
            status, reprocess_claim_token, reprocess_claimed_at, reprocess_claim_expires_at
        ) VALUES (
            'job',
            '00000000-0000-7000-8000-000000000017',
            'system.validation',
            'MVT_DLQ_VALIDATION',
            'validation',
            'quarantined',
            gen_random_uuid(),
            clock_timestamp(),
            clock_timestamp() + interval '1 minute'
        );
        RAISE EXCEPTION 'claim lifecycle constraint did not reject a quarantined row with lease data';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END
$$;
ROLLBACK;
