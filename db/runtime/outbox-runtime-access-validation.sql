-- Moventra TMS — Phase 023 Transactional Outbox runtime access validation
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
  IF NOT has_schema_privilege(runtime_role, 'outbox', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role lacks USAGE on outbox schema';
  END IF;
  IF has_schema_privilege(runtime_role, 'outbox', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role must not CREATE in outbox schema';
  END IF;
  IF NOT has_table_privilege(runtime_role, 'outbox.events', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'outbox.events', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role lacks SELECT/INSERT on outbox.events';
  END IF;
  IF has_table_privilege(runtime_role, 'outbox.events', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role must not have table-wide UPDATE on outbox.events';
  END IF;
  IF has_table_privilege(runtime_role, 'outbox.events', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role must not DELETE outbox.events';
  END IF;

  IF NOT has_column_privilege(runtime_role, 'outbox.events', 'attempt_count', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'outbox.events', 'last_attempt_at', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'outbox.events', 'claim_token', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'outbox.events', 'claimed_at', 'UPDATE')
     OR NOT has_column_privilege(runtime_role, 'outbox.events', 'published_at', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role lacks operational outbox UPDATE columns';
  END IF;

  IF has_column_privilege(runtime_role, 'outbox.events', 'payload', 'UPDATE')
     OR has_column_privilege(runtime_role, 'outbox.events', 'metadata', 'UPDATE')
     OR has_column_privilege(runtime_role, 'outbox.events', 'event_type', 'UPDATE')
     OR has_column_privilege(runtime_role, 'outbox.events', 'tenant_id', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role can mutate immutable outbox contract columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'outbox'
       AND c.relname = 'events'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled for outbox.events';
  END IF;
END
$acl$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990231-0000-7000-8000-000000000001', 'runtime-outbox-a', 'Runtime Outbox A', 'ACTIVE', 'UTC', 'USD'),
  ('01990231-0000-7000-8000-000000000002', 'runtime-outbox-b', 'Runtime Outbox B', 'ACTIVE', 'UTC', 'USD');

SET ROLE :"app_role";
SELECT set_config('moventra.tenant_id', '01990231-0000-7000-8000-000000000001', true);

INSERT INTO outbox.events (
  id, tenant_id, aggregate_type, event_type, schema_version, payload, metadata
) VALUES (
  '01990231-0000-7000-8000-000000000010',
  '01990231-0000-7000-8000-000000000001',
  'freight', 'freight.created', 1,
  '{"freightId":"synthetic"}'::jsonb,
  '{"schemaVersion":1}'::jsonb
);

UPDATE outbox.events
   SET claim_token = '01990231-0000-7000-8000-000000000020',
       claimed_at = clock_timestamp(),
       attempt_count = attempt_count + 1,
       last_attempt_at = clock_timestamp()
 WHERE id = '01990231-0000-7000-8000-000000000010';

DO $rls$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM outbox.events
   WHERE tenant_id = '01990231-0000-7000-8000-000000000002';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant outbox read was not isolated';
  END IF;

  BEGIN
    INSERT INTO outbox.events (
      tenant_id, aggregate_type, event_type, schema_version, payload
    ) VALUES (
      '01990231-0000-7000-8000-000000000002',
      'freight', 'freight.created', 1, '{}'::jsonb
    );
    RAISE EXCEPTION 'cross-tenant outbox write passed the isolation boundary';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE outbox.events
       SET payload = '{"changed":true}'::jsonb
     WHERE id = '01990231-0000-7000-8000-000000000010';
    RAISE EXCEPTION 'runtime changed immutable outbox payload';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM outbox.events
     WHERE id = '01990231-0000-7000-8000-000000000010';
    RAISE EXCEPTION 'runtime deleted an outbox event';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$rls$;

RESET ROLE;
ROLLBACK;