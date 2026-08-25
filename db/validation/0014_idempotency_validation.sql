-- Moventra TMS — Validation 0014: Idempotency
-- Phase 022 — Idempotência
\set ON_ERROR_STOP on

DO $validation$
DECLARE
  policy_count INTEGER;
BEGIN
  IF to_regclass('idempotency.records') IS NULL THEN
    RAISE EXCEPTION 'idempotency.records is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'idempotency'
       AND c.relname = 'records'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'idempotency.records must have RLS enabled';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'idempotency'
     AND tablename = 'records'
     AND policyname = 'tenant_isolation_idempotency_records';
  IF policy_count <> 1 THEN
    RAISE EXCEPTION 'idempotency tenant isolation policy is missing or duplicated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'uq_idempotency_records_tenant_operation_key'
       AND conrelid = 'idempotency.records'::regclass
  ) THEN
    RAISE EXCEPTION 'idempotency tenant+operation+key uniqueness constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'idempotency'
       AND indexname = 'ix_idempotency_records_expires_at'
  ) THEN
    RAISE EXCEPTION 'idempotency expiry index is missing';
  END IF;
END
$validation$;

BEGIN;

INSERT INTO organization.tenants (
  id, code, display_name, status, default_timezone, default_currency
) VALUES
  ('01990220-0000-7000-8000-000000000001', 'idempotency-ci-a', 'Idempotency CI A', 'ACTIVE', 'UTC', 'USD'),
  ('01990220-0000-7000-8000-000000000002', 'idempotency-ci-b', 'Idempotency CI B', 'ACTIVE', 'UTC', 'USD');

INSERT INTO idempotency.records (
  id, tenant_id, operation_key, key_hash, key_hash_version,
  fingerprint, fingerprint_version, state, expires_at
) VALUES (
  '01990220-0000-7000-8000-000000000010',
  '01990220-0000-7000-8000-000000000001',
  'validation.idempotency.execute',
  repeat('a', 64),
  1,
  repeat('b', 64),
  1,
  'PROCESSING',
  clock_timestamp() + interval '24 hours'
);

UPDATE idempotency.records
   SET state = 'COMPLETED',
       response_status = 201,
       response_media_type = 'application/json',
       response_body = '{"resourceId":"synthetic"}'::jsonb,
       response_headers = '{"location":"/synthetic"}'::jsonb,
       completed_at = clock_timestamp()
 WHERE id = '01990220-0000-7000-8000-000000000010';

DO $completed_contract$
DECLARE
  completed_count INTEGER;
BEGIN
  SELECT count(*) INTO completed_count
    FROM idempotency.records
   WHERE id = '01990220-0000-7000-8000-000000000010'
     AND state = 'COMPLETED'
     AND response_status = 201
     AND response_media_type = 'application/json';
  IF completed_count <> 1 THEN
    RAISE EXCEPTION 'completed idempotency result contract is invalid';
  END IF;
END
$completed_contract$;

DO $duplicate_key$
BEGIN
  BEGIN
    INSERT INTO idempotency.records (
      tenant_id, operation_key, key_hash, fingerprint, expires_at
    ) VALUES (
      '01990220-0000-7000-8000-000000000001',
      'validation.idempotency.execute',
      repeat('a', 64),
      repeat('c', 64),
      clock_timestamp() + interval '24 hours'
    );
    RAISE EXCEPTION 'duplicate tenant/operation/key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$duplicate_key$;

-- The same hashed client key is legal in another Tenant because isolation is part of the natural key.
INSERT INTO idempotency.records (
  tenant_id, operation_key, key_hash, fingerprint, expires_at
) VALUES (
  '01990220-0000-7000-8000-000000000002',
  'validation.idempotency.execute',
  repeat('a', 64),
  repeat('d', 64),
  clock_timestamp() + interval '24 hours'
);

DO $invalid_shapes$
BEGIN
  BEGIN
    INSERT INTO idempotency.records (
      tenant_id, operation_key, key_hash, fingerprint, expires_at
    ) VALUES (
      '01990220-0000-7000-8000-000000000001',
      'INVALID OPERATION',
      repeat('e', 64),
      repeat('f', 64),
      clock_timestamp() + interval '24 hours'
    );
    RAISE EXCEPTION 'invalid operation_key unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO idempotency.records (
      tenant_id, operation_key, key_hash, fingerprint, expires_at
    ) VALUES (
      '01990220-0000-7000-8000-000000000001',
      'validation.invalid.hash',
      'not-a-sha256',
      repeat('1', 64),
      clock_timestamp() + interval '24 hours'
    );
    RAISE EXCEPTION 'invalid key hash unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO idempotency.records (
      tenant_id, operation_key, key_hash, fingerprint, expires_at
    ) VALUES (
      '01990220-0000-7000-8000-000000000001',
      'validation.invalid.expiry',
      repeat('2', 64),
      repeat('3', 64),
      clock_timestamp() - interval '1 second'
    );
    RAISE EXCEPTION 'invalid expiry unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$invalid_shapes$;

ROLLBACK;