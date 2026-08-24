-- Moventra TMS — Validation 0007
DO $validation$
BEGIN
  IF to_regclass('identity.external_identities') IS NULL THEN
    RAISE EXCEPTION 'identity.external_identities is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_external_identities_provider_issuer_subject') THEN
    RAISE EXCEPTION 'external identity unique contract is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='identity' AND table_name='external_identities'
      AND column_name IN ('tenant_id','company_id','branch_id','password_hash','access_token','refresh_token','session_id')
  ) THEN
    RAISE EXCEPTION 'phase 013 boundary violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='identity' AND indexname='ix_external_identities_user_status') THEN
    RAISE EXCEPTION 'external identity lookup index is missing';
  END IF;
END
$validation$;
