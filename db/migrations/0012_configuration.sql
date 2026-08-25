-- Moventra TMS — Migration 0012: Configuration
-- Phase 018 — Configurações
-- Global typed definitions + tenant/company/branch overrides + append-only setting history.

CREATE SCHEMA IF NOT EXISTS configuration;

CREATE TABLE configuration.definitions (
    id UUID NOT NULL DEFAULT uuidv7(),
    key TEXT NOT NULL,
    owner_domain TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    value_type TEXT NOT NULL,
    default_value JSONB NULL,
    validation_schema JSONB NULL,
    allow_tenant_override BOOLEAN NOT NULL DEFAULT TRUE,
    allow_company_override BOOLEAN NOT NULL DEFAULT FALSE,
    allow_branch_override BOOLEAN NOT NULL DEFAULT FALSE,
    sensitivity TEXT NOT NULL DEFAULT 'INTERNAL',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_configuration_definitions PRIMARY KEY (id),
    CONSTRAINT uq_configuration_definitions_key UNIQUE (key),
    CONSTRAINT ck_configuration_definitions_key CHECK (
        key = lower(key)
        AND char_length(key) BETWEEN 3 AND 160
        AND key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,7}$'
    ),
    CONSTRAINT ck_configuration_definitions_owner_domain CHECK (
        owner_domain = lower(owner_domain)
        AND char_length(owner_domain) BETWEEN 2 AND 63
        AND owner_domain ~ '^[a-z][a-z0-9_]*$'
    ),
    CONSTRAINT ck_configuration_definitions_name CHECK (
        name = btrim(name)
        AND char_length(name) BETWEEN 2 AND 160
    ),
    CONSTRAINT ck_configuration_definitions_description CHECK (
        description IS NULL
        OR (description = btrim(description) AND char_length(description) BETWEEN 2 AND 1000)
    ),
    CONSTRAINT ck_configuration_definitions_value_type CHECK (
        value_type IN ('BOOLEAN','INTEGER','DECIMAL','STRING','ENUM','JSON','DURATION','TIMEZONE','CURRENCY')
    ),
    CONSTRAINT ck_configuration_definitions_validation_schema CHECK (
        validation_schema IS NULL OR jsonb_typeof(validation_schema) = 'object'
    ),
    CONSTRAINT ck_configuration_definitions_sensitivity CHECK (
        sensitivity IN ('PUBLIC','INTERNAL','CONFIDENTIAL')
    ),
    CONSTRAINT ck_configuration_definitions_status CHECK (
        status IN ('ACTIVE','INACTIVE')
    ),
    CONSTRAINT ck_configuration_definitions_version CHECK (version >= 1),
    CONSTRAINT ck_configuration_definitions_timestamps CHECK (updated_at >= created_at)
);
CREATE INDEX ix_configuration_definitions_owner_status
    ON configuration.definitions(owner_domain, status);

CREATE TABLE configuration.settings (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    configuration_definition_id UUID NOT NULL,
    scope_type TEXT NOT NULL,
    company_id UUID NULL,
    branch_id UUID NULL,
    value JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_configuration_settings PRIMARY KEY (id),
    CONSTRAINT uq_configuration_settings_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_configuration_settings_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_configuration_settings_definition
        FOREIGN KEY (configuration_definition_id)
        REFERENCES configuration.definitions(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_configuration_settings_company
        FOREIGN KEY (tenant_id, company_id)
        REFERENCES organization.companies(tenant_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_configuration_settings_branch
        FOREIGN KEY (tenant_id, company_id, branch_id)
        REFERENCES organization.branches(tenant_id, company_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_configuration_settings_scope_type CHECK (
        scope_type IN ('TENANT','COMPANY','BRANCH')
    ),
    CONSTRAINT ck_configuration_settings_scope_shape CHECK (
        (scope_type = 'TENANT' AND company_id IS NULL AND branch_id IS NULL)
        OR (scope_type = 'COMPANY' AND company_id IS NOT NULL AND branch_id IS NULL)
        OR (scope_type = 'BRANCH' AND company_id IS NOT NULL AND branch_id IS NOT NULL)
    ),
    CONSTRAINT ck_configuration_settings_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_configuration_settings_value_not_json_null CHECK (jsonb_typeof(value) IS NOT NULL),
    CONSTRAINT ck_configuration_settings_version CHECK (version >= 1),
    CONSTRAINT ck_configuration_settings_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_configuration_settings_active_tenant
    ON configuration.settings(tenant_id, configuration_definition_id)
    WHERE scope_type = 'TENANT' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_configuration_settings_active_company
    ON configuration.settings(tenant_id, company_id, configuration_definition_id)
    WHERE scope_type = 'COMPANY' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_configuration_settings_active_branch
    ON configuration.settings(tenant_id, company_id, branch_id, configuration_definition_id)
    WHERE scope_type = 'BRANCH' AND status = 'ACTIVE';
CREATE INDEX ix_configuration_settings_resolve
    ON configuration.settings(tenant_id, configuration_definition_id, status, scope_type);

CREATE TABLE configuration.setting_versions (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    setting_id UUID NOT NULL,
    setting_version BIGINT NOT NULL,
    value JSONB NULL,
    status TEXT NOT NULL,
    change_type TEXT NOT NULL,
    reason TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_configuration_setting_versions PRIMARY KEY (id),
    CONSTRAINT uq_configuration_setting_versions UNIQUE (tenant_id, setting_id, setting_version),
    CONSTRAINT fk_configuration_setting_versions_setting
        FOREIGN KEY (tenant_id, setting_id)
        REFERENCES configuration.settings(tenant_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_configuration_setting_versions_version CHECK (setting_version >= 1),
    CONSTRAINT ck_configuration_setting_versions_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_configuration_setting_versions_change_type CHECK (
        change_type IN ('CREATE','UPDATE','ACTIVATE','INACTIVATE','RESTORE')
    ),
    CONSTRAINT ck_configuration_setting_versions_value CHECK (
        value IS NOT NULL OR change_type = 'INACTIVATE'
    ),
    CONSTRAINT ck_configuration_setting_versions_reason CHECK (
        reason IS NULL OR (reason = btrim(reason) AND char_length(reason) BETWEEN 2 AND 500)
    )
);
CREATE INDEX ix_configuration_setting_versions_tenant_setting
    ON configuration.setting_versions(tenant_id, setting_id, setting_version DESC);

CREATE FUNCTION configuration.prevent_setting_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'configuration.setting_versions is append-only' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER trg_configuration_setting_versions_append_only
BEFORE UPDATE OR DELETE ON configuration.setting_versions
FOR EACH ROW
EXECUTE FUNCTION configuration.prevent_setting_version_mutation();

ALTER TABLE configuration.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration.setting_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_configuration_settings
    ON configuration.settings
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY tenant_isolation_configuration_setting_versions
    ON configuration.setting_versions
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

INSERT INTO security.permissions (code, description, status)
VALUES
    ('configuration.settings.read', 'Read effective organizational configuration values', 'ACTIVE'),
    ('configuration.settings.manage', 'Create and change organizational configuration overrides', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE configuration.definitions IS
    'Global platform-governed typed configuration catalog. Definitions are not tenant-owned and never store secrets.';
COMMENT ON TABLE configuration.settings IS
    'Tenant-scoped organizational configuration overrides with Tenant, Company or Branch scope and optimistic locking.';
COMMENT ON TABLE configuration.setting_versions IS
    'Tenant-scoped append-only history of configuration setting versions; complements central audit and never replaces it.';
COMMENT ON COLUMN configuration.settings.value IS
    'Validated JSONB representation of a typed non-secret configuration value. Confidential values must be redacted from logs and audit payloads.';
COMMENT ON COLUMN configuration.definitions.sensitivity IS
    'PUBLIC, INTERNAL or CONFIDENTIAL only. SECRET is deliberately unsupported; secret material belongs to Secrets Management.';
