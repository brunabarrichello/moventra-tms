-- Moventra TMS — Migration 0006: Membership
-- Phase: 012 — Memberships
-- PostgreSQL 18+
-- Scope: materialize only the tenant-scoped User <-> Tenant membership.
-- IMPORTANT: Auth, RBAC, Company/Branch scope assignments, RLS and Audit belong to later phases.

CREATE TABLE identity.memberships (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT pk_memberships PRIMARY KEY (id),
    CONSTRAINT fk_memberships_tenant_id
        FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT fk_memberships_user_id
        FOREIGN KEY (user_id)
        REFERENCES identity.users(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT uq_memberships_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_memberships_tenant_user UNIQUE (tenant_id, user_id),
    CONSTRAINT ck_memberships_status CHECK (
        status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')
    ),
    CONSTRAINT ck_memberships_version_positive CHECK (version >= 1),
    CONSTRAINT ck_memberships_timestamp_order CHECK (updated_at >= created_at)
);

CREATE INDEX ix_memberships_tenant_status
    ON identity.memberships (tenant_id, status);

CREATE INDEX ix_memberships_user_status
    ON identity.memberships (user_id, status);

COMMENT ON TABLE identity.memberships IS
    'Tenant-scoped association between a global Moventra User and a Tenant. Auth, RBAC and Company/Branch scope assignments are separate later phases.';
COMMENT ON COLUMN identity.memberships.tenant_id IS
    'Immutable SaaS tenant ownership boundary. Backend authorization must not trust tenant_id from client input alone.';
COMMENT ON COLUMN identity.memberships.user_id IS
    'Immutable global User identity associated with the Tenant. User PII must not be duplicated into Membership without explicit justification.';
COMMENT ON COLUMN identity.memberships.status IS
    'Membership lifecycle state: PENDING, ACTIVE, SUSPENDED or terminal REVOKED. ACTIVE alone does not grant business permissions.';
COMMENT ON COLUMN identity.memberships.version IS
    'Optimistic-lock version incremented atomically for mutable transitions.';
