-- Moventra TMS — Migration 0013: Feature Flags
-- Phase 019 — Feature Flags
-- Global flag catalog + environment policies + tenant-scoped targeting rules + append-only rule history.

CREATE SCHEMA IF NOT EXISTS feature_flags;

CREATE TABLE feature_flags.flags (
    id UUID NOT NULL DEFAULT uuidv7(),
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    hash_version SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_feature_flags_flags PRIMARY KEY (id),
    CONSTRAINT uq_feature_flags_flags_key UNIQUE (key),
    CONSTRAINT ck_feature_flags_flags_key CHECK (
        key = lower(key)
        AND char_length(key) BETWEEN 3 AND 160
        AND key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$'
    ),
    CONSTRAINT ck_feature_flags_flags_name CHECK (
        name = btrim(name)
        AND char_length(name) BETWEEN 2 AND 160
    ),
    CONSTRAINT ck_feature_flags_flags_description CHECK (
        description IS NULL
        OR (description = btrim(description) AND char_length(description) BETWEEN 2 AND 1000)
    ),
    CONSTRAINT ck_feature_flags_flags_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_feature_flags_flags_hash_version CHECK (hash_version BETWEEN 1 AND 32767),
    CONSTRAINT ck_feature_flags_flags_version CHECK (version >= 1),
    CONSTRAINT ck_feature_flags_flags_timestamps CHECK (updated_at >= created_at)
);
CREATE INDEX ix_feature_flags_flags_status ON feature_flags.flags(status, key);

CREATE TABLE feature_flags.environment_policies (
    id UUID NOT NULL DEFAULT uuidv7(),
    flag_id UUID NOT NULL,
    environment TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    rollout_basis_points INTEGER NOT NULL DEFAULT 10000,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_feature_flags_environment_policies PRIMARY KEY (id),
    CONSTRAINT fk_feature_flags_environment_policy_flag
        FOREIGN KEY (flag_id)
        REFERENCES feature_flags.flags(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_feature_flags_environment_policy UNIQUE (flag_id, environment),
    CONSTRAINT ck_feature_flags_environment CHECK (
        environment IN ('development','preview','staging','production')
    ),
    CONSTRAINT ck_feature_flags_environment_rollout CHECK (
        rollout_basis_points BETWEEN 0 AND 10000
    ),
    CONSTRAINT ck_feature_flags_environment_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_feature_flags_environment_version CHECK (version >= 1),
    CONSTRAINT ck_feature_flags_environment_timestamps CHECK (updated_at >= created_at)
);
CREATE INDEX ix_feature_flags_environment_lookup
    ON feature_flags.environment_policies(flag_id, environment, status);

CREATE TABLE feature_flags.rules (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    flag_id UUID NOT NULL,
    environment TEXT NULL,
    target_type TEXT NOT NULL,
    company_id UUID NULL,
    branch_id UUID NULL,
    user_id UUID NULL,
    plan_key TEXT NULL,
    enabled BOOLEAN NOT NULL,
    rollout_basis_points INTEGER NOT NULL DEFAULT 10000,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_feature_flags_rules PRIMARY KEY (id),
    CONSTRAINT uq_feature_flags_rules_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_feature_flags_rules_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES organization.tenants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_feature_flags_rules_flag
        FOREIGN KEY (flag_id)
        REFERENCES feature_flags.flags(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_feature_flags_rules_company
        FOREIGN KEY (tenant_id, company_id)
        REFERENCES organization.companies(tenant_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_feature_flags_rules_branch
        FOREIGN KEY (tenant_id, company_id, branch_id)
        REFERENCES organization.branches(tenant_id, company_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_feature_flags_rules_membership
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES identity.memberships(tenant_id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_feature_flags_rules_environment CHECK (
        environment IS NULL
        OR environment IN ('development','preview','staging','production')
    ),
    CONSTRAINT ck_feature_flags_rules_target_type CHECK (
        target_type IN ('TENANT','COMPANY','BRANCH','USER','PLAN')
    ),
    CONSTRAINT ck_feature_flags_rules_target_shape CHECK (
        (target_type = 'TENANT'
            AND company_id IS NULL AND branch_id IS NULL AND user_id IS NULL AND plan_key IS NULL)
        OR (target_type = 'COMPANY'
            AND company_id IS NOT NULL AND branch_id IS NULL AND user_id IS NULL AND plan_key IS NULL)
        OR (target_type = 'BRANCH'
            AND company_id IS NOT NULL AND branch_id IS NOT NULL AND user_id IS NULL AND plan_key IS NULL)
        OR (target_type = 'USER'
            AND company_id IS NULL AND branch_id IS NULL AND user_id IS NOT NULL AND plan_key IS NULL)
        OR (target_type = 'PLAN'
            AND company_id IS NULL AND branch_id IS NULL AND user_id IS NULL AND plan_key IS NOT NULL)
    ),
    CONSTRAINT ck_feature_flags_rules_plan_key CHECK (
        plan_key IS NULL
        OR (
            plan_key = lower(plan_key)
            AND char_length(plan_key) BETWEEN 2 AND 63
            AND plan_key ~ '^[a-z][a-z0-9_-]*$'
        )
    ),
    CONSTRAINT ck_feature_flags_rules_rollout CHECK (
        rollout_basis_points BETWEEN 0 AND 10000
    ),
    CONSTRAINT ck_feature_flags_rules_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_feature_flags_rules_version CHECK (version >= 1),
    CONSTRAINT ck_feature_flags_rules_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_feature_flags_rules_active_tenant
    ON feature_flags.rules(tenant_id, flag_id, COALESCE(environment, '*'))
    WHERE target_type = 'TENANT' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_feature_flags_rules_active_company
    ON feature_flags.rules(tenant_id, flag_id, company_id, COALESCE(environment, '*'))
    WHERE target_type = 'COMPANY' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_feature_flags_rules_active_branch
    ON feature_flags.rules(tenant_id, flag_id, company_id, branch_id, COALESCE(environment, '*'))
    WHERE target_type = 'BRANCH' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_feature_flags_rules_active_user
    ON feature_flags.rules(tenant_id, flag_id, user_id, COALESCE(environment, '*'))
    WHERE target_type = 'USER' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_feature_flags_rules_active_plan
    ON feature_flags.rules(tenant_id, flag_id, plan_key, COALESCE(environment, '*'))
    WHERE target_type = 'PLAN' AND status = 'ACTIVE';
CREATE INDEX ix_feature_flags_rules_evaluation
    ON feature_flags.rules(tenant_id, flag_id, status, target_type, environment);

CREATE TABLE feature_flags.rule_versions (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NOT NULL,
    rule_id UUID NOT NULL,
    rule_version BIGINT NOT NULL,
    enabled BOOLEAN NOT NULL,
    rollout_basis_points INTEGER NOT NULL,
    status TEXT NOT NULL,
    change_type TEXT NOT NULL,
    reason TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_feature_flags_rule_versions PRIMARY KEY (id),
    CONSTRAINT uq_feature_flags_rule_versions UNIQUE (tenant_id, rule_id, rule_version),
    CONSTRAINT fk_feature_flags_rule_versions_rule
        FOREIGN KEY (tenant_id, rule_id)
        REFERENCES feature_flags.rules(tenant_id, id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_feature_flags_rule_versions_version CHECK (rule_version >= 1),
    CONSTRAINT ck_feature_flags_rule_versions_rollout CHECK (
        rollout_basis_points BETWEEN 0 AND 10000
    ),
    CONSTRAINT ck_feature_flags_rule_versions_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_feature_flags_rule_versions_change_type CHECK (
        change_type IN ('CREATE','UPDATE','ACTIVATE','INACTIVATE','RESTORE')
    ),
    CONSTRAINT ck_feature_flags_rule_versions_reason CHECK (
        reason IS NULL
        OR (reason = btrim(reason) AND char_length(reason) BETWEEN 2 AND 500)
    )
);
CREATE INDEX ix_feature_flags_rule_versions_tenant_rule
    ON feature_flags.rule_versions(tenant_id, rule_id, rule_version DESC);

CREATE FUNCTION feature_flags.prevent_rule_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'feature_flags.rule_versions is append-only' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER trg_feature_flags_rule_versions_append_only
BEFORE UPDATE OR DELETE ON feature_flags.rule_versions
FOR EACH ROW
EXECUTE FUNCTION feature_flags.prevent_rule_version_mutation();

ALTER TABLE feature_flags.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags.rule_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_feature_flags_rules
    ON feature_flags.rules
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY tenant_isolation_feature_flags_rule_versions
    ON feature_flags.rule_versions
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

INSERT INTO security.permissions (code, description, status)
VALUES
    ('feature_flags.rules.read', 'Read feature flag targeting rules and evaluation provenance', 'ACTIVE'),
    ('feature_flags.rules.manage', 'Create and change tenant feature flag targeting rules', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE feature_flags.flags IS
    'Global platform-governed boolean feature flag catalog. Feature flags control rollout and never replace authorization.';
COMMENT ON TABLE feature_flags.environment_policies IS
    'Global platform-governed per-environment feature flag policy and rollout percentage.';
COMMENT ON TABLE feature_flags.rules IS
    'Tenant-scoped feature flag targeting rules for Tenant, Company, Branch, User or trusted Plan context.';
COMMENT ON TABLE feature_flags.rule_versions IS
    'Tenant-scoped append-only rule history. Complements central Audit and never replaces it.';
COMMENT ON COLUMN feature_flags.rules.environment IS
    'Optional trusted runtime environment restriction. NULL means all supported environments; client input is not authoritative.';
COMMENT ON COLUMN feature_flags.rules.plan_key IS
    'Trusted internal plan context key without premature dependency on the future Billing aggregate.';
COMMENT ON COLUMN feature_flags.rules.rollout_basis_points IS
    'Deterministic rollout threshold from 0 to 10000 basis points; never random per request.';