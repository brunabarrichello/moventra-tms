-- Moventra TMS — Migration 0002: Tenant
-- Phase: 008 — Tenant
-- PostgreSQL 18+
-- Scope: materialize only the SaaS tenant aggregate root.
-- IMPORTANT: Company, Branch, User, Membership, Auth, RBAC, RLS and Audit belong to later phases.

CREATE SCHEMA IF NOT EXISTS organization;

COMMENT ON SCHEMA organization IS
    'Moventra TMS organization domain. Tenant is introduced in phase 008; later organization entities require their own official phases.';

CREATE TABLE organization.tenants (
    id UUID NOT NULL DEFAULT uuidv7(),
    code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROVISIONING',
    default_timezone TEXT NOT NULL,
    default_currency CHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT pk_tenants PRIMARY KEY (id),
    CONSTRAINT uq_tenants_code UNIQUE (code),
    CONSTRAINT ck_tenants_code_format CHECK (
        code = lower(code)
        AND char_length(code) BETWEEN 3 AND 63
        AND code ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$'
    ),
    CONSTRAINT ck_tenants_display_name CHECK (
        display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 2 AND 160
    ),
    CONSTRAINT ck_tenants_status CHECK (
        status IN ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED')
    ),
    CONSTRAINT ck_tenants_default_timezone CHECK (
        default_timezone = btrim(default_timezone)
        AND char_length(default_timezone) BETWEEN 1 AND 100
        AND default_timezone ~ '^[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)*$'
    ),
    CONSTRAINT ck_tenants_default_currency CHECK (
        default_currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_tenants_version_positive CHECK (version >= 1),
    CONSTRAINT ck_tenants_timestamp_order CHECK (updated_at >= created_at)
);

COMMENT ON TABLE organization.tenants IS
    'SaaS tenant aggregate root. The root itself intentionally has no tenant_id self-reference.';
COMMENT ON COLUMN organization.tenants.code IS
    'Stable globally unique tenant business key used for administrative/routing identity; it is not an authorization primitive.';
COMMENT ON COLUMN organization.tenants.status IS
    'Lifecycle state controlled by validated domain transitions, not arbitrary CRUD updates.';
COMMENT ON COLUMN organization.tenants.default_timezone IS
    'Tenant default business timezone using an IANA identifier; full validity is enforced at the application boundary.';
COMMENT ON COLUMN organization.tenants.default_currency IS
    'Tenant default ISO 4217 currency code. Transactional records must persist their own currency when historically required.';
COMMENT ON COLUMN organization.tenants.version IS
    'Optimistic-lock version incremented atomically for mutable updates.';
