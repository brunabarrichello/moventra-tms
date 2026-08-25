-- Moventra TMS — Phase 022 idempotency runtime access validation
-- Requires psql variables runtime_role and app_role.
\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'runtime_role psql variable is required'
  \quit 3
\endif
\if :{?app_role}
\else
  \echo 'app_role psql variable is required'
  \quit 3
\endif

SELECT set_config('moventra.validation_runtime_role', :'runtime_role', false);

DO $acl$
DECLARE
  runtime_role TEXT := current_setting('moventra.validation_runtime_role');
BEGIN
  IF NOT has_schema_privilege(runtime_role, 'idempotency', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role lacks USAGE on idempotency schema';
  END IF;
  IF has_schema_privilege(runtime_role, 'idempotency', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role must not CREATE in idempotency schema';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'idempotency.records', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'idempotency.records', 'INSERT')
     OR NOT has_table_privilege(runtime_role, 'idempotency.records', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks SELECT/INSERT/UPDATE on idempotency.records';
  END IF;
  IF has_table_privilege(runtime_role, 'idempotency.records', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not DELETE idempotency.records';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'idempotency'
       AND c.relname = 'records'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled for idempotency.records';
  END IF;
END
$acl$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990221-0000-7000-8000-000000000001', 'runtime-idem-a', 'Runtime Idempotency A', 'ACTIVE', 'UTC', 'USD'),
  ('01990221-0000-7000-8000-000000000002', 'runtime-idem-b', 'Runtime Idempotency B', 'ACTIVE', 'UTC', 'USD');

SET ROLE :"app_role";

SELECT set_config('moventra.tenant_id', '01990221-0000-7000-8000-000000000001', true);

INSERT INTO idempotency.records (
  id, tenant_id, operation_key, key_hash, key_hash_version,
  fingerprint, fingerprint_version, expires_at
) VALUES (
  '01990221-0000-7000-8000-000000000010',
  '01990221-0000-7000-8000-000000000001',
  'validation.runtime.idempotency',
  repeat('1', 64), 1,
  repeat('2', 64), 1,
  clock_timestamp() + interval '24 hours'
);

UPDATE idempotency.records
   SET state = 'COMPLETED',
       response_status = 200,
       response_media_type = 'application/json',
       response_body = '{"ok":true}'::jsonb,
       completed_at = clock_timestamp()
 WHERE id = '01990221-0000-7000-8000-000000000010';

DO $rls$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM idempotency.records
   WHERE tenant_id = '01990221-0000-7000-8000-000000000002';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant idempotency read was not isolated';
  END IF;

  BEGIN
    INSERT INTO idempotency.records (
      tenant_id, operation_key, key_hash, fingerprint, expires_at
    ) VALUES (
      '01990221-0000-7000-8000-000000000002',
      'validation.runtime.idempotency',
      repeat('3', 64),
      repeat('4', 64),
      clock_timestamp() + interval '24 hours'
    );
    RAISE EXCEPTION 'cross-tenant idempotency write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM idempotency.records
     WHERE id = '01990221-0000-7000-8000-000000000010';
    RAISE EXCEPTION 'runtime idempotency DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$rls$;

RESET ROLE;
ROLLBACK;