-- Moventra TMS — Migration 0004: Branch
-- Phase: 010 — Filial
-- PostgreSQL 18+
-- Scope: materialize only the tenant/company-scoped Branch entity.
-- IMPORTANT: Users, Memberships, Auth, RBAC, RLS and Audit belong to later phases.

CREATE TABLE organization.branches (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_headquarters BOOLEAN NOT NULL DEFAULT FALSE,
    registration_country CHAR(2),
    primary_tax_identifier_type TEXT,
    primary_tax_identifier TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    default_timezone TEXT,
    default_currency CHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT pk_branches PRIMARY KEY (id),
    CONSTRAINT fk_branches_company_scope
        FOREIGN KEY (tenant_id, company_id)
        REFERENCES organization.companies(tenant_id, id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT uq_branches_tenant_company_id UNIQUE (tenant_id, company_id, id),
    CONSTRAINT uq_branches_tenant_company_code UNIQUE (tenant_id, company_id, code),
    CONSTRAINT ck_branches_code_format CHECK (
        code = lower(code)
        AND char_length(code) BETWEEN 3 AND 63
        AND code ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$'
    ),
    CONSTRAINT ck_branches_display_name CHECK (
        display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 2 AND 160
    ),
    CONSTRAINT ck_branches_registration_country CHECK (
        registration_country IS NULL
        OR registration_country ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT ck_branches_tax_identifier_pair CHECK (
        (primary_tax_identifier_type IS NULL AND primary_tax_identifier IS NULL)
        OR
        (
            primary_tax_identifier_type IS NOT NULL
            AND primary_tax_identifier IS NOT NULL
            AND registration_country IS NOT NULL
        )
    ),
    CONSTRAINT ck_branches_tax_identifier_type CHECK (
        primary_tax_identifier_type IS NULL
        OR (
            primary_tax_identifier_type = upper(primary_tax_identifier_type)
            AND char_length(primary_tax_identifier_type) BETWEEN 2 AND 32
            AND primary_tax_identifier_type ~ '^[A-Z0-9][A-Z0-9._-]*$'
        )
    ),
    CONSTRAINT ck_branches_tax_identifier_value CHECK (
        primary_tax_identifier IS NULL
        OR (
            primary_tax_identifier = upper(primary_tax_identifier)
            AND char_length(primary_tax_identifier) BETWEEN 2 AND 64
            AND primary_tax_identifier ~ '^[A-Z0-9]+$'
        )
    ),
    CONSTRAINT ck_branches_status CHECK (
        status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED')
    ),
    CONSTRAINT ck_branches_default_timezone CHECK (
        default_timezone IS NULL
        OR (
            default_timezone = btrim(default_timezone)
            AND char_length(default_timezone) BETWEEN 1 AND 100
            AND default_timezone ~ '^[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)*$'
        )
    ),
    CONSTRAINT ck_branches_default_currency CHECK (
        default_currency IS NULL
        OR default_currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_branches_version_positive CHECK (version >= 1),
    CONSTRAINT ck_branches_timestamp_order CHECK (updated_at >= created_at)
);

CREATE INDEX ix_branches_tenant_company_status
    ON organization.branches (tenant_id, company_id, status);

CREATE UNIQUE INDEX uq_branches_tenant_company_headquarters
    ON organization.branches (tenant_id, company_id)
    WHERE is_headquarters;

CREATE UNIQUE INDEX uq_branches_tenant_tax_identifier
    ON organization.branches (
        tenant_id,
        registration_country,
        primary_tax_identifier_type,
        primary_tax_identifier
    )
    WHERE primary_tax_identifier IS NOT NULL;

COMMENT ON TABLE organization.branches IS
    'Tenant/company-scoped organizational branches. Phase 010 only; access-control and later business entities belong to later phases.';
COMMENT ON COLUMN organization.branches.tenant_id IS
    'Immutable SaaS tenant ownership boundary. Authorization must not rely on this value from client input alone.';
COMMENT ON COLUMN organization.branches.company_id IS
    'Immutable owning Company. Composite FK with tenant_id guarantees same-tenant ownership.';
COMMENT ON COLUMN organization.branches.code IS
    'Stable business key unique inside the owning Company.';
COMMENT ON COLUMN organization.branches.is_headquarters IS
    'Marks the single optional headquarters branch for the owning Company; uniqueness is enforced by a partial index.';
COMMENT ON COLUMN organization.branches.registration_country IS
    'Optional ISO 3166-1 alpha-2 jurisdiction used when branch-level registration/tax identity is required.';
COMMENT ON COLUMN organization.branches.primary_tax_identifier_type IS
    'Optional jurisdictional establishment identifier type such as CNPJ, EIN or VAT; intentionally not Brazil-only.';
COMMENT ON COLUMN organization.branches.primary_tax_identifier IS
    'Optional normalized branch/establishment tax identifier paired with type and registration country.';
COMMENT ON COLUMN organization.branches.status IS
    'Branch lifecycle state controlled by explicit domain transitions.';
COMMENT ON COLUMN organization.branches.default_timezone IS
    'Optional branch timezone override. NULL means inherit Company then Tenant.';
COMMENT ON COLUMN organization.branches.default_currency IS
    'Optional branch currency override. NULL means inherit Company then Tenant.';
COMMENT ON COLUMN organization.branches.version IS
    'Optimistic-lock version incremented atomically for mutable updates.';
