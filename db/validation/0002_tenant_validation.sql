-- Moventra TMS — Validation for migration 0002
-- Phase: 008 — Tenant
-- Read-only catalog and contract checks. Failures must fail CI/deployment.

DO $validation$
DECLARE
    id_default TEXT;
    status_default TEXT;
    version_default TEXT;
BEGIN
    IF current_setting('server_version_num')::INTEGER < 180000 THEN
        RAISE EXCEPTION 'PostgreSQL 18+ is required for uuidv7()';
    END IF;

    IF to_regnamespace('organization') IS NULL THEN
        RAISE EXCEPTION 'organization schema is missing';
    END IF;

    IF to_regclass('organization.tenants') IS NULL THEN
        RAISE EXCEPTION 'organization.tenants table is missing';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'tenant_id'
    ) THEN
        RAISE EXCEPTION 'tenant aggregate root must not contain a tenant_id self-reference';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'id'
           AND data_type = 'uuid'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.id must be UUID NOT NULL';
    END IF;

    SELECT column_default
      INTO id_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'tenants'
       AND column_name = 'id';

    IF id_default IS NULL OR id_default !~* 'uuidv7\(\)' THEN
        RAISE EXCEPTION 'organization.tenants.id must default to uuidv7()';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'code'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.code must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'display_name'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.display_name must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'status'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.status must be TEXT NOT NULL';
    END IF;

    SELECT column_default
      INTO status_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'tenants'
       AND column_name = 'status';

    IF status_default IS NULL OR status_default NOT ILIKE '%PROVISIONING%' THEN
        RAISE EXCEPTION 'organization.tenants.status must default to PROVISIONING';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'default_timezone'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.default_timezone must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'default_currency'
           AND data_type = 'character'
           AND character_maximum_length = 3
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.default_currency must be CHAR(3) NOT NULL';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name IN ('created_at', 'updated_at')
           AND data_type = 'timestamp with time zone'
           AND is_nullable = 'NO'
    ) <> 2 THEN
        RAISE EXCEPTION 'created_at and updated_at must be TIMESTAMPTZ NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'tenants'
           AND column_name = 'version'
           AND data_type = 'bigint'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.tenants.version must be BIGINT NOT NULL';
    END IF;

    SELECT column_default
      INTO version_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'tenants'
       AND column_name = 'version';

    IF version_default IS NULL OR btrim(version_default, '()''::bigint') <> '1' THEN
        IF version_default NOT IN ('1', '1::bigint') THEN
            RAISE EXCEPTION 'organization.tenants.version must default to 1';
        END IF;
    END IF;

    IF (
        SELECT count(*)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'tenants'
           AND c.conname IN (
               'pk_tenants',
               'uq_tenants_code',
               'ck_tenants_code_format',
               'ck_tenants_display_name',
               'ck_tenants_status',
               'ck_tenants_default_timezone',
               'ck_tenants_default_currency',
               'ck_tenants_version_positive',
               'ck_tenants_timestamp_order'
           )
    ) <> 9 THEN
        RAISE EXCEPTION 'one or more required tenant constraints are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM moventra_meta.schema_migrations
         WHERE version = 2
           AND name = '0002_tenant.sql'
           AND checksum ~ '^[0-9a-f]{64}$'
    ) THEN
        RAISE EXCEPTION 'migration 0002 history is missing or invalid';
    END IF;
END
$validation$;

SELECT
    id,
    code,
    display_name,
    status,
    default_timezone,
    default_currency,
    created_at,
    updated_at,
    version
FROM organization.tenants
ORDER BY created_at, id
LIMIT 0;
