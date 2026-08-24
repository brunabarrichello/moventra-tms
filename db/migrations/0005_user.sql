-- Moventra TMS — Migration 0005: User
-- Phase: 011 — Usuários
-- PostgreSQL 18+
-- Scope: materialize only the global/provider-agnostic business User identity.
-- IMPORTANT: Memberships, Auth/external identities, RBAC, RLS and Audit belong to later phases.

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.users (
    id UUID NOT NULL DEFAULT uuidv7(),
    primary_email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    preferred_locale TEXT,
    preferred_timezone TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uq_users_primary_email UNIQUE (primary_email),
    CONSTRAINT ck_users_primary_email CHECK (
        primary_email = lower(btrim(primary_email))
        AND char_length(primary_email) BETWEEN 3 AND 320
        AND primary_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
    CONSTRAINT ck_users_display_name CHECK (
        display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 2 AND 160
    ),
    CONSTRAINT ck_users_preferred_locale CHECK (
        preferred_locale IS NULL
        OR (
            preferred_locale = btrim(preferred_locale)
            AND char_length(preferred_locale) BETWEEN 2 AND 35
            AND preferred_locale ~ '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$'
        )
    ),
    CONSTRAINT ck_users_preferred_timezone CHECK (
        preferred_timezone IS NULL
        OR (
            preferred_timezone = btrim(preferred_timezone)
            AND char_length(preferred_timezone) BETWEEN 1 AND 100
            AND preferred_timezone ~ '^[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)*$'
        )
    ),
    CONSTRAINT ck_users_status CHECK (
        status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')
    ),
    CONSTRAINT ck_users_version_positive CHECK (version >= 1),
    CONSTRAINT ck_users_timestamp_order CHECK (updated_at >= created_at)
);

CREATE INDEX ix_users_status ON identity.users (status);

COMMENT ON SCHEMA identity IS
    'Provider-agnostic business identities. Membership and authentication artifacts are introduced only by their dedicated phases.';
COMMENT ON TABLE identity.users IS
    'Global Moventra business user identities. Users are not tenant-scoped; Tenant/Company/Branch access is modeled by future Memberships.';
COMMENT ON COLUMN identity.users.id IS
    'Canonical Moventra User identifier. Authentication provider subjects must never replace this key.';
COMMENT ON COLUMN identity.users.primary_email IS
    'Canonical lowercase primary email. PII; avoid unnecessary logging and exposure.';
COMMENT ON COLUMN identity.users.display_name IS
    'Human-friendly display name independent of organizational memberships.';
COMMENT ON COLUMN identity.users.preferred_locale IS
    'Optional personal locale preference. NULL allows contextual/browser defaults.';
COMMENT ON COLUMN identity.users.preferred_timezone IS
    'Optional personal IANA timezone preference. NULL allows organizational/client fallback.';
COMMENT ON COLUMN identity.users.status IS
    'Global business-identity lifecycle state; not a Tenant membership or authentication state.';
COMMENT ON COLUMN identity.users.version IS
    'Optimistic-lock version incremented atomically for mutable updates.';
