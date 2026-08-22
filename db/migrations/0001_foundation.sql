-- Moventra TMS — Migration 0001: Foundation
-- PostgreSQL 18+
-- Scope: organization, identity, RBAC and audit foundation only.
-- No operational/business-domain tables are created here.

CREATE SCHEMA IF NOT EXISTS organization;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS organization.tenants (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    code VARCHAR(32) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    locale VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_tenants_status CHECK (status IN ('active','suspended','disabled','deleted')),
    CONSTRAINT ck_tenants_code_nonblank CHECK (btrim(code) <> ''),
    CONSTRAINT ck_tenants_slug_lower CHECK (slug = lower(slug))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_code_active
    ON organization.tenants (lower(code))
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_slug_active
    ON organization.tenants (slug)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS organization.companies (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    legal_name VARCHAR(200) NOT NULL,
    trade_name VARCHAR(200),
    registration_country CHAR(2) NOT NULL DEFAULT 'BR',
    tax_id VARCHAR(64),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    timezone VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT fk_companies_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id),
    CONSTRAINT uq_companies_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_companies_status CHECK (status IN ('active','suspended','disabled','deleted')),
    CONSTRAINT ck_companies_legal_name_nonblank CHECK (btrim(legal_name) <> '')
);

CREATE INDEX IF NOT EXISTS ix_companies_tenant
    ON organization.companies (tenant_id)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_tax_id_active
    ON organization.companies (tenant_id, registration_country, tax_id)
    WHERE tax_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS organization.branches (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    timezone VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT fk_branches_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id),
    CONSTRAINT fk_branches_company_scope FOREIGN KEY (tenant_id, company_id)
        REFERENCES organization.companies(tenant_id, id),
    CONSTRAINT uq_branches_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_branches_tenant_company_id UNIQUE (tenant_id, company_id, id),
    CONSTRAINT ck_branches_status CHECK (status IN ('active','suspended','disabled','deleted')),
    CONSTRAINT ck_branches_code_nonblank CHECK (btrim(code) <> ''),
    CONSTRAINT ck_branches_name_nonblank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_code_active
    ON organization.branches (tenant_id, company_id, lower(code))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_branches_tenant_company
    ON organization.branches (tenant_id, company_id)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS identity.users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    email VARCHAR(320) NOT NULL,
    display_name VARCHAR(200),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    locale VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_users_status CHECK (status IN ('invited','active','blocked','disabled','deleted')),
    CONSTRAINT ck_users_email_nonblank CHECK (btrim(email) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_active
    ON identity.users (lower(email))
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS identity.user_identities (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL,
    provider VARCHAR(60) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    provider_email VARCHAR(320),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_user_identities_user FOREIGN KEY (user_id)
        REFERENCES identity.users(id),
    CONSTRAINT uq_user_identity_provider_subject UNIQUE (provider, provider_subject),
    CONSTRAINT ck_user_identities_provider_nonblank CHECK (btrim(provider) <> ''),
    CONSTRAINT ck_user_identities_subject_nonblank CHECK (btrim(provider_subject) <> '')
);

CREATE INDEX IF NOT EXISTS ix_user_identities_user
    ON identity.user_identities (user_id);

CREATE TABLE IF NOT EXISTS identity.memberships (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    company_id UUID,
    branch_id UUID,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    is_default BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id),
    CONSTRAINT fk_memberships_user FOREIGN KEY (user_id)
        REFERENCES identity.users(id),
    CONSTRAINT fk_memberships_company_scope FOREIGN KEY (tenant_id, company_id)
        REFERENCES organization.companies(tenant_id, id),
    CONSTRAINT fk_memberships_branch_scope FOREIGN KEY (tenant_id, company_id, branch_id)
        REFERENCES organization.branches(tenant_id, company_id, id),
    CONSTRAINT uq_memberships_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_memberships_status CHECK (status IN ('invited','active','blocked','disabled')),
    CONSTRAINT ck_memberships_branch_requires_company CHECK (branch_id IS NULL OR company_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_memberships_scope_active
    ON identity.memberships (
        tenant_id,
        user_id,
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_memberships_user_active
    ON identity.memberships (user_id, tenant_id)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS identity.permissions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    permission_key VARCHAR(160) NOT NULL UNIQUE,
    module VARCHAR(80) NOT NULL,
    resource VARCHAR(80) NOT NULL,
    action VARCHAR(80) NOT NULL,
    description VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_permissions_key_nonblank CHECK (btrim(permission_key) <> '')
);

CREATE TABLE IF NOT EXISTS identity.roles (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(300),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    is_system BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id),
    CONSTRAINT uq_roles_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_roles_status CHECK (status IN ('active','disabled')),
    CONSTRAINT ck_roles_code_nonblank CHECK (btrim(code) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_code_active
    ON identity.roles (tenant_id, lower(code))
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS identity.role_permissions (
    tenant_id UUID NOT NULL,
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role_scope FOREIGN KEY (tenant_id, role_id)
        REFERENCES identity.roles(tenant_id, id),
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id)
        REFERENCES identity.permissions(id)
);

CREATE INDEX IF NOT EXISTS ix_role_permissions_tenant_role
    ON identity.role_permissions (tenant_id, role_id);

CREATE TABLE IF NOT EXISTS identity.membership_roles (
    tenant_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    role_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (membership_id, role_id),
    CONSTRAINT fk_membership_roles_membership_scope FOREIGN KEY (tenant_id, membership_id)
        REFERENCES identity.memberships(tenant_id, id),
    CONSTRAINT fk_membership_roles_role_scope FOREIGN KEY (tenant_id, role_id)
        REFERENCES identity.roles(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS ix_membership_roles_tenant_membership
    ON identity.membership_roles (tenant_id, membership_id);

CREATE TABLE IF NOT EXISTS audit.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    company_id UUID,
    branch_id UUID,
    actor_type VARCHAR(30) NOT NULL,
    actor_id UUID,
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(120) NOT NULL,
    entity_id UUID,
    previous_data JSONB,
    new_data JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_id UUID,
    correlation_id UUID,
    transaction_id UUID,
    ip_address INET,
    user_agent TEXT,
    reason TEXT,
    result VARCHAR(30) NOT NULL DEFAULT 'success',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id),
    CONSTRAINT fk_audit_company_scope FOREIGN KEY (tenant_id, company_id)
        REFERENCES organization.companies(tenant_id, id),
    CONSTRAINT fk_audit_branch_scope FOREIGN KEY (tenant_id, company_id, branch_id)
        REFERENCES organization.branches(tenant_id, company_id, id),
    CONSTRAINT fk_audit_actor_user FOREIGN KEY (actor_id)
        REFERENCES identity.users(id),
    CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('user','service','integration','system','anonymous')),
    CONSTRAINT ck_audit_result CHECK (result IN ('success','failure','partial','denied')),
    CONSTRAINT ck_audit_action_nonblank CHECK (btrim(action) <> ''),
    CONSTRAINT ck_audit_entity_type_nonblank CHECK (btrim(entity_type) <> ''),
    CONSTRAINT ck_audit_branch_requires_company CHECK (branch_id IS NULL OR company_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_audit_tenant_occurred
    ON audit.audit_logs (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_audit_entity
    ON audit.audit_logs (tenant_id, entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_audit_actor
    ON audit.audit_logs (tenant_id, actor_id, occurred_at DESC)
    WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_audit_correlation
    ON audit.audit_logs (correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION audit.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS 'BEGIN RAISE EXCEPTION ''audit.audit_logs is append-only; UPDATE/DELETE are forbidden''; END;';

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit.audit_logs
FOR EACH ROW EXECUTE FUNCTION audit.reject_audit_mutation();

COMMENT ON SCHEMA organization IS 'Moventra TMS organizational boundary: tenants, companies and branches.';
COMMENT ON SCHEMA identity IS 'Moventra TMS users, external identities, memberships and RBAC.';
COMMENT ON SCHEMA audit IS 'Moventra TMS immutable application audit trail foundation.';
