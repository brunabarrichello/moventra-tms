-- Moventra TMS — Validation for migration 0001
-- Phase: 006 — Banco Base
-- Read-only contract checks. Failures raise exceptions and must fail CI/deployment.

DO $validation$
DECLARE
    applied_checksum TEXT;
BEGIN
    IF current_setting('server_version_num')::INTEGER < 180000 THEN
        RAISE EXCEPTION 'PostgreSQL 18+ is required';
    END IF;

    IF to_regnamespace('moventra_meta') IS NULL THEN
        RAISE EXCEPTION 'moventra_meta schema is missing';
    END IF;

    IF to_regclass('moventra_meta.schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'moventra_meta.schema_migrations is missing';
    END IF;

    IF to_regclass('moventra_meta.database_contract') IS NULL THEN
        RAISE EXCEPTION 'moventra_meta.database_contract is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM moventra_meta.database_contract
        WHERE id = 1
          AND product = 'Moventra TMS'
          AND technical_name = 'moventra-tms'
          AND contract_version = 1
    ) THEN
        RAISE EXCEPTION 'database foundation contract record is invalid';
    END IF;

    SELECT checksum
      INTO applied_checksum
      FROM moventra_meta.schema_migrations
     WHERE version = 1;

    IF applied_checksum IS NULL OR applied_checksum !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'migration 0001 checksum history is missing or invalid';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.schemata
        WHERE schema_name IN (
            'organization', 'identity', 'audit', 'crm', 'commercial', 'operations',
            'drivers', 'fleet', 'tracking', 'risk', 'finance', 'fiscal',
            'notifications', 'integrations', 'billing'
        )
    ) THEN
        RAISE EXCEPTION 'phase 006 introduced a schema that belongs to a later phase';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'moventra_meta')
          AND table_name IN (
              'tenants', 'companies', 'branches', 'users', 'user_identities',
              'memberships', 'permissions', 'roles', 'role_permissions',
              'membership_roles', 'audit_logs'
          )
    ) THEN
        RAISE EXCEPTION 'phase 006 introduced a domain table that belongs to a later phase';
    END IF;
END
$validation$;

SELECT
    dc.product,
    dc.technical_name,
    dc.contract_version,
    sm.version AS migration_version,
    sm.name AS migration_name,
    sm.checksum
FROM moventra_meta.database_contract dc
JOIN moventra_meta.schema_migrations sm ON sm.version = 1
WHERE dc.id = 1;
