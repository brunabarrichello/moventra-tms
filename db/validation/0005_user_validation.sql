-- Moventra TMS — Validation for migration 0005
-- Phase: 011 — Usuários
-- Read-only cumulative catalog/contract checks. Failures must fail CI/deployment.

DO $validation$
DECLARE
    id_default TEXT;
    status_default TEXT;
    version_default TEXT;
BEGIN
    IF current_setting('server_version_num')::INTEGER < 180000 THEN
        RAISE EXCEPTION 'PostgreSQL 18+ is required for uuidv7()';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'identity') THEN
        RAISE EXCEPTION 'identity schema is missing';
    END IF;

    IF to_regclass('identity.users') IS NULL THEN
        RAISE EXCEPTION 'identity.users table is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name = 'id'
           AND data_type = 'uuid'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'identity.users.id must be UUID NOT NULL';
    END IF;

    SELECT column_default
      INTO id_default
      FROM information_schema.columns
     WHERE table_schema = 'identity'
       AND table_name = 'users'
       AND column_name = 'id';

    IF id_default IS NULL OR id_default !~* 'uuidv7\(\)' THEN
        RAISE EXCEPTION 'identity.users.id must default to uuidv7()';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name IN ('tenant_id', 'company_id', 'branch_id')
    ) THEN
        RAISE EXCEPTION 'global User identity must not contain tenant/company/branch ownership columns';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name = 'primary_email'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'identity.users.primary_email must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name = 'display_name'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'identity.users.display_name must be TEXT NOT NULL';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name IN ('preferred_locale', 'preferred_timezone')
           AND data_type = 'text'
           AND is_nullable = 'YES'
    ) <> 2 THEN
        RAISE EXCEPTION 'user optional preference columns have an invalid physical contract';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name = 'status'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'identity.users.status must be TEXT NOT NULL';
    END IF;

    SELECT column_default
      INTO status_default
      FROM information_schema.columns
     WHERE table_schema = 'identity'
       AND table_name = 'users'
       AND column_name = 'status';

    IF status_default IS NULL OR status_default NOT ILIKE '%PENDING%' THEN
        RAISE EXCEPTION 'identity.users.status must default to PENDING';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name IN ('created_at', 'updated_at')
           AND data_type = 'timestamp with time zone'
           AND is_nullable = 'NO'
    ) <> 2 THEN
        RAISE EXCEPTION 'user created_at and updated_at must be TIMESTAMPTZ NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'users'
           AND column_name = 'version'
           AND data_type = 'bigint'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'identity.users.version must be BIGINT NOT NULL';
    END IF;

    SELECT column_default
      INTO version_default
      FROM information_schema.columns
     WHERE table_schema = 'identity'
       AND table_name = 'users'
       AND column_name = 'version';

    IF version_default IS NULL OR version_default !~ '^\(?1(?:::bigint)?\)?$' THEN
        RAISE EXCEPTION 'identity.users.version must default to 1';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'identity'
           AND t.relname = 'users'
           AND c.conname = 'uq_users_primary_email'
           AND c.contype = 'u'
    ) THEN
        RAISE EXCEPTION 'global primary_email uniqueness is missing';
    END IF;

    IF to_regclass('identity.ix_users_status') IS NULL THEN
        RAISE EXCEPTION 'user status index is missing';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'identity'
           AND t.relname = 'users'
           AND c.conname IN (
               'pk_users',
               'uq_users_primary_email',
               'ck_users_primary_email',
               'ck_users_display_name',
               'ck_users_preferred_locale',
               'ck_users_preferred_timezone',
               'ck_users_status',
               'ck_users_version_positive',
               'ck_users_timestamp_order'
           )
    ) <> 9 THEN
        RAISE EXCEPTION 'one or more required user constraints are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM moventra_meta.schema_migrations
         WHERE version = 5
           AND name = '0005_user.sql'
           AND checksum ~ '^[0-9a-f]{64}$'
    ) THEN
        RAISE EXCEPTION 'migration 0005 history is missing or invalid';
    END IF;
END
$validation$;

SELECT
    id,
    primary_email,
    display_name,
    preferred_locale,
    preferred_timezone,
    status,
    created_at,
    updated_at,
    version
FROM identity.users
ORDER BY created_at, id
LIMIT 0;
