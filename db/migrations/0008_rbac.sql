-- Moventra TMS — Migration 0008: RBAC
-- Phase 014 — RBAC
CREATE SCHEMA IF NOT EXISTS security;

CREATE TABLE security.permissions (
    id UUID NOT NULL DEFAULT uuidv7(),
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_permissions PRIMARY KEY (id),
    CONSTRAINT uq_permissions_code UNIQUE (code),
    CONSTRAINT ck_permissions_code CHECK (code ~ '^[a-z][a-z0-9_.]{2,127}$'),
    CONSTRAINT ck_permissions_description CHECK (length(btrim(description)) BETWEEN 2 AND 500),
    CONSTRAINT ck_permissions_status CHECK (status IN ('ACTIVE','RETIRED')),
    CONSTRAINT ck_permissions_version CHECK (version >= 1),
    CONSTRAINT ck_permissions_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE security.roles (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_roles PRIMARY KEY (id),
    CONSTRAINT fk_roles_tenant_id FOREIGN KEY (tenant_id) REFERENCES organization.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_roles_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_roles_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT ck_roles_code CHECK (code ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
    CONSTRAINT ck_roles_name CHECK (length(btrim(name)) BETWEEN 2 AND 160),
    CONSTRAINT ck_roles_description CHECK (description IS NULL OR length(btrim(description)) BETWEEN 2 AND 500),
    CONSTRAINT ck_roles_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_roles_version CHECK (version >= 1),
    CONSTRAINT ck_roles_timestamps CHECK (updated_at >= created_at)
);
CREATE INDEX ix_roles_tenant_status ON security.roles(tenant_id, status);

CREATE TABLE security.role_permissions (
    tenant_id UUID NOT NULL,
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_role_permissions PRIMARY KEY (tenant_id, role_id, permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (tenant_id, role_id) REFERENCES security.roles(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES security.permissions(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX ix_role_permissions_permission ON security.role_permissions(permission_id, tenant_id);

CREATE TABLE security.membership_roles (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    role_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_membership_roles PRIMARY KEY (id),
    CONSTRAINT uq_membership_roles_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_membership_roles_membership FOREIGN KEY (tenant_id, membership_id) REFERENCES identity.memberships(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_membership_roles_role FOREIGN KEY (tenant_id, role_id) REFERENCES security.roles(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_membership_roles_status CHECK (status IN ('ACTIVE','REVOKED')),
    CONSTRAINT ck_membership_roles_version CHECK (version >= 1),
    CONSTRAINT ck_membership_roles_timestamps CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX uq_membership_roles_active ON security.membership_roles(tenant_id, membership_id, role_id) WHERE status='ACTIVE';
CREATE INDEX ix_membership_roles_membership_status ON security.membership_roles(tenant_id, membership_id, status);

COMMENT ON TABLE security.permissions IS 'Global atomic business permission catalog. Codes are stable contracts.';
COMMENT ON TABLE security.roles IS 'Tenant-scoped RBAC roles. Company/Branch scopes are added in phase 015.';
COMMENT ON TABLE security.membership_roles IS 'Tenant-coherent role assignment to Membership; ACTIVE grants are evaluated only by backend authorization.';
