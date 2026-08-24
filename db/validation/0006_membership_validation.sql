-- Moventra TMS — Validation for migration 0006
-- Phase: 012 — Memberships
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

    IF to_regclass('identity.memberships') IS NULL THEN
        RAISE EXCEPTION 'identity.memberships table is missing';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'memberships'
           AND column_name IN ('id', 'tenant_id', 'user_id')
           AND data_type = 'uuid'
           AND is_nullable = 'NO'
    ) <> 3 THEN
        RAISE EXCEPTION 'membership id, tenant_id and user_id must be UUID NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = 'memberships'
           AND column_name IN ('company_id', 'branch_id', 'role_id', 'provider_subject', 'password_hash', 'session_id')
    ) THEN
        RAISE EXCEPTION 'phase 012 membership must not anticipate organizational scope, RBAC or Auth columns';
    END IF;

    SELECT column_default INTO id_default
      FROM information_schema.columns
     WHERE table_schema = 'identity' AND table_name = 'memberships' AND column_name = 'id';

    IF id_default IS NULL OR id_default !~* 'uuidv7\(\)' THEN
        RAISE EXCEPTION 'identity.memberships.id must default to uuidv7()';
    END IF;

    SELECT column_default INTO status_default
      FROM information_schema.columns
     WHERE table_schema = 'identity' AND table_name = 'memberships' AND column_name = 'status';

    IF status_default IS NULL OR status_default NOT ILIKE '%PENDING%' THEN
        RAISE EXCEPTION 'identity.memberships.status must default to PENDING';
    END IF;

    SELECT column_default INTO version_default
      FROM information_schema.columns
     WHERE table_schema = 'identity' AND table_name = 'memberships' AND column_name = 'version';

    IF version_default IS NULL OR version_default !~ '^\(?1(?:::bigint)?\)?$' THEN
        RAISE EXCEPTION 'identity.memberships.version must default to 1';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'identity' AND t.relname = 'memberships'
          AND c.conname = 'fk_memberships_tenant_id'
          AND c.contype = 'f'
          AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES organization.tenants(id)%'
    ) THEN
        RAISE EXCEPTION 'membership Tenant FK is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'identity' AND t.relname = 'memberships'
          AND c.conname = 'fk_memberships_user_id'
          AND c.contype = 'f'
          AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES identity.users(id)%'
    ) THEN
        RAISE EXCEPTION 'membership User FK is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'identity' AND t.relname = 'memberships'
          AND c.conname = 'uq_memberships_tenant_id_id' AND c.contype = 'u'
    ) THEN
        RAISE EXCEPTION 'UNIQUE (tenant_id, id) is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'identity' AND t.relname = 'memberships'
          AND c.conname = 'uq_memberships_tenant_user' AND c.contype = 'u'
    ) THEN
        RAISE EXCEPTION 'UNIQUE (tenant_id, user_id) is missing';
    END IF;

    IF to_regclass('identity.ix_memberships_tenant_status') IS NULL THEN
        RAISE EXCEPTION 'membership tenant/status index is missing';
    END IF;

    IF to_regclass('identity.ix_memberships_user_status') IS NULL THEN
        RAISE EXCEPTION 'membership user/status index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM moventra_meta.schema_migrations
         WHERE version = 6
           AND name = '0006_membership.sql'
           AND checksum ~ '^[0-9a-f]{64}$'
    ) THEN
        RAISE EXCEPTION 'migration 0006 history is missing or invalid';
    END IF;
END
$validation$;

SELECT id, tenant_id, user_id, status, created_at, updated_at, version
FROM identity.memberships
ORDER BY created_at, id
LIMIT 0;
