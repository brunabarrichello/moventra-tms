-- Moventra TMS — Migration 0011: Central Audit
-- Phase 017 — Auditoria Central
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.audit_events (
    id UUID NOT NULL DEFAULT uuidv7(),
    tenant_id UUID NULL,
    actor_user_id UUID NULL,
    actor_membership_id UUID NULL,
    company_id UUID NULL,
    branch_id UUID NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NULL,
    outcome TEXT NOT NULL,
    request_id TEXT NULL,
    correlation_id TEXT NULL,
    reason TEXT NULL,
    before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_audit_events PRIMARY KEY (id),
    CONSTRAINT fk_audit_events_tenant FOREIGN KEY (tenant_id) REFERENCES organization.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audit_events_actor_user FOREIGN KEY (actor_user_id) REFERENCES identity.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audit_events_actor_membership FOREIGN KEY (tenant_id, actor_membership_id) REFERENCES identity.memberships(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audit_events_company FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audit_events_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES organization.branches(tenant_id, company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_audit_events_actor_membership_scope CHECK (actor_membership_id IS NULL OR tenant_id IS NOT NULL),
    CONSTRAINT ck_audit_events_org_scope CHECK (
      (branch_id IS NULL OR (tenant_id IS NOT NULL AND company_id IS NOT NULL)) AND
      (company_id IS NULL OR tenant_id IS NOT NULL)
    ),
    CONSTRAINT ck_audit_events_category CHECK (category ~ '^[a-z][a-z0-9_.-]{1,63}$'),
    CONSTRAINT ck_audit_events_action CHECK (action ~ '^[a-z][a-z0-9_.-]{1,127}$'),
    CONSTRAINT ck_audit_events_entity_type CHECK (entity_type ~ '^[a-z][a-z0-9_.-]{1,127}$'),
    CONSTRAINT ck_audit_events_entity_id CHECK (entity_id IS NULL OR length(entity_id) BETWEEN 1 AND 200),
    CONSTRAINT ck_audit_events_outcome CHECK (outcome IN ('SUCCESS','DENIED','FAILED')),
    CONSTRAINT ck_audit_events_reason CHECK (reason IS NULL OR length(reason) <= 1000),
    CONSTRAINT ck_audit_events_before_object CHECK (jsonb_typeof(before_data)='object' AND octet_length(before_data::text) <= 65536),
    CONSTRAINT ck_audit_events_after_object CHECK (jsonb_typeof(after_data)='object' AND octet_length(after_data::text) <= 65536),
    CONSTRAINT ck_audit_events_metadata_object CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text) <= 65536)
);
CREATE INDEX ix_audit_events_tenant_occurred ON audit.audit_events(tenant_id, occurred_at DESC);
CREATE INDEX ix_audit_events_actor_occurred ON audit.audit_events(actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX ix_audit_events_entity_occurred ON audit.audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_events_correlation ON audit.audit_events(correlation_id, occurred_at DESC) WHERE correlation_id IS NOT NULL;

CREATE FUNCTION audit.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_events is append-only' USING ERRCODE='55000';
END
$$;
CREATE TRIGGER trg_audit_events_append_only
BEFORE UPDATE OR DELETE ON audit.audit_events
FOR EACH ROW EXECUTE FUNCTION audit.prevent_audit_event_mutation();

ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_events ON audit.audit_events
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

COMMENT ON TABLE audit.audit_events IS 'Append-only central audit trail. Payloads must be minimized and redacted before insertion; secrets and authentication tokens are forbidden.';
COMMENT ON COLUMN audit.audit_events.metadata IS 'Redacted structured context only. Never store passwords, credentials, access/refresh tokens, authorization headers or raw session secrets.';
