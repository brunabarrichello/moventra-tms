-- Moventra TMS — Validation for migration 0001
-- Phase: 006 — Banco Base
-- Read-only contract checks. Failures raise exceptions and must fail CI/deployment.
--
-- This validation is intentionally forward-compatible: it verifies that the
-- phase-006 foundation remains intact after later migrations are applied.
-- The immutable contents of 0001_foundation.sql are separately guarded by
-- tests/architecture/database-foundation.test.js so later domain schemas do
-- not create false failures in this cumulative validation contract.

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
     WHERE version = 1
       AND name = '0001_foundation.sql';

    IF applied_checksum IS NULL OR applied_checksum !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'migration 0001 checksum history is missing or invalid';
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
