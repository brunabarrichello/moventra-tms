-- Moventra TMS — Migration 0009: Organizational Scope
-- Phase 015 — Escopo Organizacional
CREATE TABLE security.organizational_scopes (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    scope_level TEXT NOT NULL,
    company_id UUID NULL,
    branch_id UUID NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_organizational_scopes PRIMARY KEY (id),
    CONSTRAINT fk_organizational_scopes_tenant FOREIGN KEY (tenant_id) REFERENCES organization.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_organizational_scopes_company FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_organizational_scopes_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES organization.branches(tenant_id, company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_organizational_scopes_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_organizational_scopes_level CHECK (scope_level IN ('TENANT','COMPANY','BRANCH')),
    CONSTRAINT ck_organizational_scopes_shape CHECK (
      (scope_level='TENANT' AND company_id IS NULL AND branch_id IS NULL) OR
      (scope_level='COMPANY' AND company_id IS NOT NULL AND branch_id IS NULL) OR
      (scope_level='BRANCH' AND company_id IS NOT NULL AND branch_id IS NOT NULL)
    ),
    CONSTRAINT ck_organizational_scopes_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_organizational_scopes_version CHECK (version >= 1),
    CONSTRAINT ck_organizational_scopes_timestamps CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX uq_organizational_scope_tenant ON security.organizational_scopes(tenant_id) WHERE scope_level='TENANT';
CREATE UNIQUE INDEX uq_organizational_scope_company ON security.organizational_scopes(tenant_id, company_id) WHERE scope_level='COMPANY';
CREATE UNIQUE INDEX uq_organizational_scope_branch ON security.organizational_scopes(tenant_id, company_id, branch_id) WHERE scope_level='BRANCH';
CREATE INDEX ix_organizational_scopes_tenant_status ON security.organizational_scopes(tenant_id, status);

CREATE TABLE security.role_assignment_scopes (
    tenant_id UUID NOT NULL,
    assignment_id UUID NOT NULL,
    scope_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_role_assignment_scopes PRIMARY KEY (tenant_id, assignment_id, scope_id),
    CONSTRAINT fk_role_assignment_scopes_assignment FOREIGN KEY (tenant_id, assignment_id) REFERENCES security.membership_roles(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_role_assignment_scopes_scope FOREIGN KEY (tenant_id, scope_id) REFERENCES security.organizational_scopes(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX ix_role_assignment_scopes_scope ON security.role_assignment_scopes(tenant_id, scope_id, assignment_id);

COMMENT ON TABLE security.organizational_scopes IS 'Explicit tenant/company/branch authorization targets. Hierarchy is protected by tenant-aware composite foreign keys.';
COMMENT ON TABLE security.role_assignment_scopes IS 'Links RBAC role assignments to explicit organizational scopes; an unscoped assignment grants no resource scope.';
