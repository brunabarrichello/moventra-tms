-- Moventra TMS — Phase 026 DLQ runtime access validation
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
  IF NOT has_schema_privilege(runtime_role, 'dlq', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role lacks USAGE on dlq schema';
  END IF;
  IF has_schema_privilege(runtime_role, 'dlq', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role must not CREATE in dlq schema';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'dlq.entries', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role lacks SELECT on dlq.entries';
  END IF;
  IF has_table_privilege(runtime_role, 'dlq.entries', 'INSERT')
     OR has_table_privilege(runtime_role, 'dlq.entries', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not INSERT/DELETE dlq.entries';
  END IF;
  IF has_table_privilege(runtime_role, 'dlq.system_entries', 'SELECT')
     OR has_table_privilege(runtime_role, 'dlq.system_entries', 'INSERT')
     OR has_table_privilege(runtime_role, 'dlq.system_entries', 'UPDATE')
     OR has_table_privilege(runtime_role, 'dlq.system_entries', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must have no table access to dlq.system_entries';
  END IF;

  IF NOT has_column_privilege(runtime_role, 'dlq.entries', 'status', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'dlq.entries', 'version', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'dlq.entries', 'next_reprocess_at', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks required DLQ lifecycle column privileges';
  END IF;

  IF has_column_privilege(runtime_role, 'dlq.entries', 'tenant_id', 'UPDATE')
     OR has_column_privilege(runtime_role, 'dlq.entries', 'source_id', 'UPDATE')
     OR has_column_privilege(runtime_role, 'dlq.entries', 'snapshot', 'UPDATE')
     OR has_column_privilege(runtime_role, 'dlq.entries', 'metadata', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role must not mutate DLQ ownership/source/snapshot columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'dlq'
       AND c.relname = 'entries'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled for dlq.entries';
  END IF;
END
$acl$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990226-0000-7000-8000-000000000001', 'runtime-dlq-a', 'Runtime DLQ A', 'ACTIVE', 'UTC', 'USD'),
  ('01990226-0000-7000-8000-000000000002', 'runtime-dlq-b', 'Runtime DLQ B', 'ACTIVE', 'UTC', 'USD');

INSERT INTO dlq.entries (
  id, tenant_id, source_kind, source_id, source_type,
  failure_code, failure_class, snapshot, metadata
) VALUES
  (
    '01990226-0000-7000-8000-000000000010',
    '01990226-0000-7000-8000-000000000001',
    'message',
    '01990226-0000-7000-8000-000000000011',
    'validation.message',
    'MVT_DLQ_VALIDATION',
    'terminal',
    '{"messageId":"01990226-0000-7000-8000-000000000011"}'::jsonb,
    '{}'::jsonb
  ),
  (
    '01990226-0000-7000-8000-000000000020',
    '01990226-0000-7000-8000-000000000002',
    'message',
    '01990226-0000-7000-8000-000000000021',
    'validation.message',
    'MVT_DLQ_VALIDATION',
    'terminal',
    '{"messageId":"01990226-0000-7000-8000-000000000021"}'::jsonb,
    '{}'::jsonb
  );

INSERT INTO dlq.system_entries (
  id, source_kind, source_id, source_type, failure_code, failure_class
) VALUES (
  '01990226-0000-7000-8000-000000000030',
  'job',
  '01990226-0000-7000-8000-000000000031',
  'system.validation',
  'MVT_DLQ_VALIDATION',
  'terminal'
);

SET ROLE :"app_role";
SELECT set_config('moventra.tenant_id', '01990226-0000-7000-8000-000000000001', true);

DO $rls$
DECLARE
  own_count INTEGER;
  other_count INTEGER;
BEGIN
  SELECT count(*) INTO own_count
    FROM dlq.entries
   WHERE tenant_id = '01990226-0000-7000-8000-000000000001';
  IF own_count <> 1 THEN
    RAISE EXCEPTION 'runtime must see exactly its tenant DLQ entry';
  END IF;

  SELECT count(*) INTO other_count
    FROM dlq.entries
   WHERE tenant_id = '01990226-0000-7000-8000-000000000002';
  IF other_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant DLQ read was not isolated';
  END IF;

  UPDATE dlq.entries
     SET status = 'reprocess_pending',
         next_reprocess_at = clock_timestamp(),
         version = version + 1,
         updated_at = clock_timestamp()
   WHERE id = '01990226-0000-7000-8000-000000000010'
     AND version = 1
     AND status = 'quarantined';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorized tenant DLQ lifecycle update failed';
  END IF;

  BEGIN
    UPDATE dlq.entries
       SET snapshot = '{"tampered":true}'::jsonb
     WHERE id = '01990226-0000-7000-8000-000000000010';
    RAISE EXCEPTION 'runtime DLQ snapshot mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO dlq.entries (
      tenant_id, source_kind, source_id, source_type, failure_code, failure_class
    ) VALUES (
      '01990226-0000-7000-8000-000000000001',
      'message',
      '01990226-0000-7000-8000-000000000099',
      'validation.message',
      'MVT_DLQ_VALIDATION',
      'terminal'
    );
    RAISE EXCEPTION 'runtime DLQ INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM count(*) FROM dlq.system_entries;
    RAISE EXCEPTION 'runtime system DLQ SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$rls$;

RESET ROLE;
ROLLBACK;
