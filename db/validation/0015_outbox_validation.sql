-- Moventra TMS — Validation 0015: Transactional Outbox
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  policy_count INTEGER;
BEGIN
  IF to_regclass('outbox.events') IS NULL THEN
    RAISE EXCEPTION 'outbox.events is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'outbox' AND c.relname = 'events' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'outbox.events must have RLS enabled';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'outbox' AND tablename = 'events'
    AND policyname = 'tenant_isolation_outbox_events';
  IF policy_count <> 1 THEN
    RAISE EXCEPTION 'outbox tenant isolation policy is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'outbox' AND indexname = 'ix_outbox_events_pending_eligibility'
  ) THEN
    RAISE EXCEPTION 'outbox pending eligibility index is missing';
  END IF;
END
$validation$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990230-0000-7000-8000-000000000001', 'outbox-ci-a', 'Outbox CI A', 'ACTIVE', 'UTC', 'USD'),
  ('01990230-0000-7000-8000-000000000002', 'outbox-ci-b', 'Outbox CI B', 'ACTIVE', 'UTC', 'USD');

INSERT INTO outbox.events (
  id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
  payload, metadata, dedupe_key
) VALUES (
  '01990230-0000-7000-8000-000000000010',
  '01990230-0000-7000-8000-000000000001',
  'freight',
  '01990230-0000-7000-8000-000000000020',
  'freight.created', 1,
  '{"freightId":"01990230-0000-7000-8000-000000000020"}'::jsonb,
  '{"correlationId":"corr-validation","schemaVersion":1}'::jsonb,
  'freight:validation:1'
);

UPDATE outbox.events
SET claim_token = '01990230-0000-7000-8000-000000000030',
    claimed_at = clock_timestamp(),
    attempt_count = attempt_count + 1,
    last_attempt_at = clock_timestamp()
WHERE id = '01990230-0000-7000-8000-000000000010';

UPDATE outbox.events
SET published_at = clock_timestamp(), claim_token = NULL, claimed_at = NULL
WHERE id = '01990230-0000-7000-8000-000000000010';

DO $lifecycle$
DECLARE
  event_count INTEGER;
BEGIN
  SELECT count(*) INTO event_count
  FROM outbox.events
  WHERE id = '01990230-0000-7000-8000-000000000010'
    AND published_at IS NOT NULL
    AND claim_token IS NULL
    AND claimed_at IS NULL
    AND attempt_count = 1;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'outbox published lifecycle is invalid';
  END IF;
END
$lifecycle$;

-- The optional logical dedupe hint is not a global uniqueness boundary.
INSERT INTO outbox.events (
  tenant_id, aggregate_type, event_type, schema_version, payload, metadata, dedupe_key
) VALUES
  ('01990230-0000-7000-8000-000000000001', 'freight', 'freight.updated', 1, '{}'::jsonb, '{}'::jsonb, 'freight:validation:1'),
  ('01990230-0000-7000-8000-000000000002', 'freight', 'freight.updated', 1, '{}'::jsonb, '{}'::jsonb, 'freight:validation:1');

ROLLBACK;