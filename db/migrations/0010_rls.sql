-- Moventra TMS — Migration 0010: Row Level Security
-- Phase 016 — RLS / Defesa adicional
-- RLS is defense-in-depth; backend Membership/RBAC/scope authorization remains mandatory.

CREATE OR REPLACE FUNCTION security.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('moventra.tenant_id', true), '')::uuid
$$;

ALTER TABLE organization.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.organizational_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.role_assignment_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenants ON organization.tenants
  USING (id = security.current_tenant_id())
  WITH CHECK (id = security.current_tenant_id());
CREATE POLICY tenant_isolation_companies ON organization.companies
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_branches ON organization.branches
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_memberships ON identity.memberships
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_roles ON security.roles
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_role_permissions ON security.role_permissions
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_membership_roles ON security.membership_roles
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_organizational_scopes ON security.organizational_scopes
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());
CREATE POLICY tenant_isolation_role_assignment_scopes ON security.role_assignment_scopes
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

COMMENT ON FUNCTION security.current_tenant_id() IS 'Transaction-local Tenant context used only as RLS defense-in-depth. It does not replace backend authorization.';
