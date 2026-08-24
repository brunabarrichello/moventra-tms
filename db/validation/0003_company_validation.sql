-- Moventra TMS — Validation for migration 0003
-- Phase: 009 — Empresa
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

    IF to_regclass('organization.companies') IS NULL THEN
        RAISE EXCEPTION 'organization.companies table is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'id'
           AND data_type = 'uuid'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.id must be UUID NOT NULL';
    END IF;

    SELECT column_default
      INTO id_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'companies'
       AND column_name = 'id';

    IF id_default IS NULL OR id_default !~* 'uuidv7\(\)' THEN
        RAISE EXCEPTION 'organization.companies.id must default to uuidv7()';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'tenant_id'
           AND data_type = 'uuid'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.tenant_id must be UUID NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'code'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.code must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'legal_name'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.legal_name must be TEXT NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'registration_country'
           AND data_type = 'character'
           AND character_maximum_length = 2
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.registration_country must be CHAR(2) NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'status'
           AND data_type = 'text'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.status must be TEXT NOT NULL';
    END IF;

    SELECT column_default
      INTO status_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'companies'
       AND column_name = 'status';

    IF status_default IS NULL OR status_default NOT ILIKE '%DRAFT%' THEN
        RAISE EXCEPTION 'organization.companies.status must default to DRAFT';
    END IF;

    IF (
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name IN ('created_at', 'updated_at')
           AND data_type = 'timestamp with time zone'
           AND is_nullable = 'NO'
    ) <> 2 THEN
        RAISE EXCEPTION 'company created_at and updated_at must be TIMESTAMPTZ NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'organization'
           AND table_name = 'companies'
           AND column_name = 'version'
           AND data_type = 'bigint'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'organization.companies.version must be BIGINT NOT NULL';
    END IF;

    SELECT column_default
      INTO version_default
      FROM information_schema.columns
     WHERE table_schema = 'organization'
       AND table_name = 'companies'
       AND column_name = 'version';

    IF version_default IS NULL OR version_default !~ '^\(?1(?:::bigint)?\)?$' THEN
        RAISE EXCEPTION 'organization.companies.version must default to 1';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'companies'
           AND c.conname = 'fk_companies_tenant_id'
           AND c.contype = 'f'
           AND pg_get_constraintdef(c.oid) ILIKE '%FOREIGN KEY (tenant_id) REFERENCES organization.tenants(id)%'
    ) THEN
        RAISE EXCEPTION 'company tenant foreign key is missing or invalid';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'organization'
           AND t.relname = 'companies'
           AND c.conname IN (
               'pk_companies',
               'fk_companies_tenant_id',
               'uq_companies_tenant_id_id',
               'uq_companies_tenant_id_code',
               'ck_companies_code_format',
               'ck_companies_legal_name',
               'ck_companies_display_name',
               'ck_companies_registration_country',
               'ck_companies_tax_identifier_pair',
               'ck_companies_tax_identifier_type',
               'ck_companies_tax_identifier_value',
               'ck_companies_status',
               'ck_companies_default_timezone',
               'ck_companies_default_currency',
               'ck_companies_version_positive',
               'ck_companies_timestamp_order'
           )
    ) <> 16 THEN
        RAISE EXCEPTION 'one or more required company constraints are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_indexes
         WHERE schemaname = 'organization'
           AND tablename = 'companies'
           AND indexname = 'ix_companies_tenant_id_status'
    ) THEN
        RAISE EXCEPTION 'company tenant/status index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_indexes
         WHERE schemaname = 'organization'
           AND tablename = 'companies'
           AND indexname = 'uq_companies_tenant_tax_identifier'
           AND indexdef ILIKE '%WHERE (primary_tax_identifier IS NOT NULL)%'
    ) THEN
        RAISE EXCEPTION 'company tenant-aware tax identifier unique index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM moventra_meta.schema_migrations
         WHERE version = 3
           AND name = '0003_company.sql'
           AND checksum ~ '^[0-9a-f]{64}$'
    ) THEN
        RAISE EXCEPTION 'migration 0003 history is missing or invalid';
    END IF;
END
$validation$;

SELECT
    id,
    tenant_id,
    code,
    legal_name,
    display_name,
    registration_country,
    primary_tax_identifier_type,
    primary_tax_identifier,
    status,
    default_timezone,
    default_currency,
    created_at,
    updated_at,
    version
FROM organization.companies
ORDER BY tenant_id, created_at, id
LIMIT 0;
