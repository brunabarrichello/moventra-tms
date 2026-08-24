-- Moventra TMS — Migration 0003: Company
-- Phase: 009 — Empresa
-- PostgreSQL 18+
-- Scope: materialize only the tenant-scoped Company entity.
-- IMPORTANT: Branch, User, Membership, Auth, RBAC, RLS and Audit belong to later phases.

CREATE TABLE organization.companies (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    display_name TEXT,
    registration_country CHAR(2) NOT NULL,
    primary_tax_identifier_type TEXT,
    primary_tax_identifier TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    default_timezone TEXT,
    default_currency CHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT pk_companies PRIMARY KEY (id),
    CONSTRAINT fk_companies_tenant_id
        FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT uq_companies_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_companies_tenant_id_code UNIQUE (tenant_id, code),
    CONSTRAINT ck_companies_code_format CHECK (
        code = lower(code)
        AND char_length(code) BETWEEN 3 AND 63
        AND code ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$'
    ),
    CONSTRAINT ck_companies_legal_name CHECK (
        legal_name = btrim(legal_name)
        AND char_length(legal_name) BETWEEN 2 AND 200
    ),
    CONSTRAINT ck_companies_display_name CHECK (
        display_name IS NULL
        OR (
            display_name = btrim(display_name)
            AND char_length(display_name) BETWEEN 2 AND 160
        )
    ),
    CONSTRAINT ck_companies_registration_country CHECK (
        registration_country ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT ck_companies_tax_identifier_pair CHECK (
        (primary_tax_identifier_type IS NULL AND primary_tax_identifier IS NULL)
        OR
        (primary_tax_identifier_type IS NOT NULL AND primary_tax_identifier IS NOT NULL)
    ),
    CONSTRAINT ck_companies_tax_identifier_type CHECK (
        primary_tax_identifier_type IS NULL
        OR (
            primary_tax_identifier_type = upper(primary_tax_identifier_type)
            AND char_length(primary_tax_identifier_type) BETWEEN 2 AND 32
            AND primary_tax_identifier_type ~ '^[A-Z0-9][A-Z0-9._-]*$'
        )
    ),
    CONSTRAINT ck_companies_tax_identifier_value CHECK (
        primary_tax_identifier IS NULL
        OR (
            primary_tax_identifier = upper(primary_tax_identifier)
            AND char_length(primary_tax_identifier) BETWEEN 2 AND 64
            AND primary_tax_identifier ~ '^[A-Z0-9]+$'
        )
    ),
    CONSTRAINT ck_companies_status CHECK (
        status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED')
    ),
    CONSTRAINT ck_companies_default_timezone CHECK (
        default_timezone IS NULL
        OR (
            default_timezone = btrim(default_timezone)
            AND char_length(default_timezone) BETWEEN 1 AND 100
            AND default_timezone ~ '^[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)*$'
        )
    ),
    CONSTRAINT ck_companies_default_currency CHECK (
        default_currency IS NULL
        OR default_currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_companies_version_positive CHECK (version >= 1),
    CONSTRAINT ck_companies_timestamp_order CHECK (updated_at >= created_at)
);

CREATE INDEX ix_companies_tenant_id_status
    ON organization.companies (tenant_id, status);

CREATE UNIQUE INDEX uq_companies_tenant_tax_identifier
    ON organization.companies (
        tenant_id,
        registration_country,
        primary_tax_identifier_type,
        primary_tax_identifier
    )
    WHERE primary_tax_identifier IS NOT NULL;

COMMENT ON TABLE organization.companies IS
    'Tenant-scoped legal/operational companies. Phase 009 only; branches and access-control entities belong to later phases.';
COMMENT ON COLUMN organization.companies.tenant_id IS
    'Immutable SaaS tenant ownership boundary. Authorization must not rely on this value from client input alone.';
COMMENT ON COLUMN organization.companies.code IS
    'Stable business key unique within the owning tenant.';
COMMENT ON COLUMN organization.companies.registration_country IS
    'ISO 3166-1 alpha-2 country of legal registration.';
COMMENT ON COLUMN organization.companies.primary_tax_identifier_type IS
    'Optional jurisdictional identifier type such as CNPJ, EIN or VAT. The central schema intentionally avoids a Brazil-only type.';
COMMENT ON COLUMN organization.companies.primary_tax_identifier IS
    'Optional normalized primary tax identifier paired with primary_tax_identifier_type.';
COMMENT ON COLUMN organization.companies.status IS
    'Company lifecycle state controlled by explicit domain transitions.';
COMMENT ON COLUMN organization.companies.default_timezone IS
    'Optional company timezone override. NULL means inherit the tenant default.';
COMMENT ON COLUMN organization.companies.default_currency IS
    'Optional company currency override. NULL means inherit the tenant default.';
COMMENT ON COLUMN organization.companies.version IS
    'Optimistic-lock version incremented atomically for mutable updates.';
