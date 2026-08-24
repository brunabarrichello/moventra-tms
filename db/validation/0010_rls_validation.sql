-- Moventra TMS — Validation 0010
DO $validation$
DECLARE
  protected_table TEXT;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'organization.tenants',
    'organization.companies',
    'organization.branches',
    'identity.memberships',
    'security.roles',
    'security.role_permissions',
    'security.membership_roles',
    'security.organizational_scopes',
    'security.role_assignment_scopes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=split_part(protected_table,'.',1)
        AND c.relname=split_part(protected_table,'.',2)
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS not enabled for %', protected_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='security' AND p.proname='current_tenant_id') THEN
    RAISE EXCEPTION 'security.current_tenant_id is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname,c.relname) IN (('identity','users'),('identity','external_identities'),('security','permissions'))
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'global identity/security tables must not have tenant RLS';
  END IF;
END
$validation$;
