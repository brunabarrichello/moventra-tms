-- Moventra TMS — Validation 0008
DO $validation$
BEGIN
  IF to_regclass('security.permissions') IS NULL OR to_regclass('security.roles') IS NULL OR to_regclass('security.role_permissions') IS NULL OR to_regclass('security.membership_roles') IS NULL THEN
    RAISE EXCEPTION 'RBAC tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_roles_tenant_id_id') THEN RAISE EXCEPTION 'role tenant composite key missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_membership_roles_membership') THEN RAISE EXCEPTION 'membership role tenant-aware FK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_membership_roles_role') THEN RAISE EXCEPTION 'role assignment tenant-aware FK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='security' AND indexname='uq_membership_roles_active') THEN RAISE EXCEPTION 'active assignment uniqueness missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='security' AND table_name IN ('roles','membership_roles') AND column_name IN ('company_id','branch_id')) THEN RAISE EXCEPTION 'phase 015 scope anticipated'; END IF;
END
$validation$;
