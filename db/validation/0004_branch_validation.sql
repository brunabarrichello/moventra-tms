-- Moventra TMS — Validation for migration 0004
-- Phase: 010 — Filial
-- Read-only catalog and contract checks. Failures must fail CI/deployment.

DO $validation$
DECLARE
    id_default TEXT;
    status_default TEXT;
    headquarters_default TEXT;
    version_default TEXT;
BEGIN
    IF current_setting('server_version_num')::INTEGER < 180000 THEN
        RAISE EXCEPTION 'PostgreSQL 18+ is required for uuidv7()';
    END IF;

    IF to_regclass('organization.branches') IS NULL THEN
        RAISE EXCEPTION 'organization.branches table is missing';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name IN ('id', 'tenant_id', 'company_id')
           AND data_type = 'uuid'
           AND is_nullable = 'NO'
    ) <> 3 THEN
        RAISE EXCEPTION 'branch id, tenant_id and company_id must be UUID NOT NULL';
    END IF;

    SELECT column_default
      INTO id_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'branches'
       AND column_name = 'id';

    IF id_default IS NULL OR id_default !~* 'uuidv7\(\)' THEN
        RAISE EXCEPTION 'organization.branches.id must default to uuidv7()';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'code'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.branches.code must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'display_name'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.branches.display_name must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'is_headquarters'
           AND data_type = 'boolean'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.branches.is_headquarters must be BOOLEAN NOT NULL';
    END IF;

    SELECT column_default
      INTO headquarters_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'branches'
       AND column_name = 'is_headquarters';

    IF headquarters_default IS NULL OR headquarters_default NOT ILIKE '%false%' THEN
        RAISE EXCEPTION 'organization.branches.is_headquarters must default to false';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'registration_country'
           AND data_type = 'character'
           AND character_maximum_length = 2
           AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'organization.branches.registration_country must be nullable CHAR(2)';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name IN ('primary_tax_identifier_type', 'primary_tax_identifier', 'default_timezone')
           AND data_type = 'text'
           AND is_nullable = 'YES'
    ) <> 3 THEN
        RAISE EXCEPTION 'branch optional text attributes have an invalid physical contract';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'default_currency'
           AND data_type = 'character'
           AND character_maximum_length = 3
           AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'organization.branches.default_currency must be nullable CHAR(3)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'status'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.branches.status must be TEXT NOT NULL';
    END IF;

    SELECT column_default
      INTO status_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'branches'
       AND column_name = 'status';

    IF status_default IS NULL OR status_default NOT ILIKE '%DRAFT%' THEN
        RAISE EXCEPTION 'organization.branches.status must default to DRAFT';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name IN ('created_at', 'updated_at')
           AND data_type = 'timestamp with time zone'
           AND is_nullable = 'NO'
    ) <> 2 THEN
        RAISE EXCEPTION 'branch created_at and updated_at must be TIMESTAMPTZ NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'branches'
           AND column_name = 'version'
           AND data_type = 'bigint'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.branches.version must be BIGINT NOT NULL';
    END IF;

    SELECT column_default
      INTO version_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'branches'
       AND column_name = 'version';

    IF version_default IS NULL OR version_default !~ '^\(?1(?:::bigint)?\)?$' THEN
        RAISE EXCEPTION 'organization.branches.version must default to 1';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'branches'
           AND c.conname = 'fk_branches_company_scope'
           AND c.contype = 'f'
           AND pg_get_constraintdef(c.oid) ILIKE '%FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id)%'
    ) THEN
        RAISE EXCEPTION 'tenant/company composite FK from branches to companies is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'branches'
           AND c.conname = 'uq_branches_tenant_company_id'
           AND c.contype = 'u'
    ) THEN
        RAISE EXCEPTION 'UNIQUE (tenant_id, company_id, id) is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'branches'
           AND c.conname = 'uq_branches_tenant_company_code'
           AND c.contype = 'u'
    ) THEN
        RAISE EXCEPTION 'tenant/company-scoped branch code uniqueness is missing';
    END IF;

    IF to_regclass('organization.ix_branches_tenant_company_status') IS NULL THEN
        RAISE EXCEPTION 'branch tenant/company/status index is missing';
    END IF;

    IF to_regclass('organization.uq_branches_tenant_company_headquarters') IS NULL THEN
        RAISE EXCEPTION 'branch headquarters unique partial index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_indexes
         WHERE schemaname = 'organization'
           AND indexname = 'uq_branches_tenant_company_headquarters'
           AND indexdef ILIKE '%UNIQUE INDEX%'
           AND indexdef ILIKE '%WHERE is_headquarters%'
    ) THEN
        RAISE EXCEPTION 'headquarters index must be unique and partial';
    END IF;

    IF to_regclass('organization.uq_branches_tenant_tax_identifier') IS NULL THEN
        RAISE EXCEPTION 'branch tax identifier unique partial index is missing';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'branches'
           AND c.conname IN (
               'pk_branches',
               'fk_branches_company_scope',
               'uq_branches_tenant_company_id',
               'uq_branches_tenant_company_code',
               'ck_branches_code_format',
               'ck_branches_display_name',
               'ck_branches_registration_country',
               'ck_branches_tax_identifier_pair',
               'ck_branches_tax_identifier_type',
               'ck_branches_tax_identifier_value',
               'ck_branches_status',
               'ck_branches_default_timezone',
               'ck_branches_default_currency',
               'ck_branches_version_positive',
               'ck_branches_timestamp_order'
           )
    ) <> 15 THEN
        RAISE EXCEPTION 'one or more required branch constraints are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM moventra_meta.schema_migrations
         WHERE version = 4
           AND name = '0004_branch.sql'
           AND checksum ~ '^[0-9a-f]{64}$'
    ) THEN
        RAISE EXCEPTION 'migration 0004 history is missing or invalid';
    END IF;
END
$validation$;

SELECT
    id,
    tenant_id,
    company_id,
    code,
    display_name,
    is_headquarters,
    registration_country,
    primary_tax_identifier_type,
    primary_tax_identifier,
    status,
    default_timezone,
    default_currency,
    created_at,
    updated_at,
    version
FROM organization.branches
ORDER BY created_at, id
LIMIT 0;
