-- Moventra TMS — Validation 0011
DO $validation$
BEGIN
  IF to_regclass('audit.audit_events') IS NULL THEN
    RAISE EXCEPTION 'audit.audit_events missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'audit'
       AND c.relname = 'audit_events'
       AND a.attname = 'tenant_id'
       AND a.attnotnull
       AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'audit tenant_id must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_audit_events_append_only'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'audit'
       AND tablename = 'audit_events'
       AND policyname = 'tenant_isolation_audit_events'
  ) THEN
    RAISE EXCEPTION 'audit tenant RLS policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'audit'
       AND c.relname = 'audit_events'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'audit RLS is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_audit_events_actor_membership'
  ) THEN
    RAISE EXCEPTION 'actor membership FK missing';
  END IF;
END
$validation$;
