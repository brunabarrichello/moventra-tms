-- Moventra TMS — Validation 0009
DO $validation$
BEGIN
  IF to_regclass('security.organizational_scopes') IS NULL OR to_regclass('security.role_assignment_scopes') IS NULL THEN
    RAISE EXCEPTION 'organizational scope tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_organizational_scopes_company') THEN RAISE EXCEPTION 'company scope FK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_organizational_scopes_branch') THEN RAISE EXCEPTION 'branch scope FK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_role_assignment_scopes_assignment') THEN RAISE EXCEPTION 'assignment scope FK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='security' AND indexname='uq_organizational_scope_tenant') THEN RAISE EXCEPTION 'tenant scope uniqueness missing'; END IF;
END
$validation$;
