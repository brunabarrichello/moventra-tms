-- Moventra TMS — Phase 026 / Batch 2 DLQ worker-ingestion validation
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  function_oid OID;
BEGIN
  SELECT to_regprocedure('dlq.quarantine_outbox_message(uuid,text,text,jsonb,smallint)')
    INTO function_oid;

  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'dlq.quarantine_outbox_message capability is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE oid = function_oid
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'DLQ ingestion capability must be SECURITY DEFINER';
  END IF;

  IF has_function_privilege(
       'public',
       'dlq.quarantine_outbox_message(uuid,text,text,jsonb,smallint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute DLQ ingestion capability';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'dlq'
       AND relation.relname = 'entries'
       AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'dlq.entries must remain protected by RLS';
  END IF;
END
$validation$;

-- The capability must derive tenant identity from Outbox and return no row for an unknown
-- source id. This proves callers cannot manufacture tenant ownership through parameters.
DO $fail_closed$
DECLARE
  returned_rows INTEGER;
BEGIN
  SELECT count(*)
    INTO returned_rows
    FROM dlq.quarantine_outbox_message(
      '01990260-0000-7000-8000-00000000ffff'::uuid,
      'MESSAGING_DEAD_LETTERED',
      'consumer_terminal',
      '{}'::jsonb,
      5::smallint
    );

  IF returned_rows <> 0 THEN
    RAISE EXCEPTION 'unknown Outbox source unexpectedly produced a DLQ row';
  END IF;
END
$fail_closed$;
