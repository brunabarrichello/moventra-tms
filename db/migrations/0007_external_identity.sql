-- Moventra TMS — Migration 0007: External Identity
-- Phase 013 — Auth provider-agnostic
CREATE TABLE identity.external_identities (
    id UUID NOT NULL DEFAULT uuidv7(),
    user_id UUID NOT NULL,
    provider_key TEXT NOT NULL,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_external_identities PRIMARY KEY (id),
    CONSTRAINT fk_external_identities_user_id FOREIGN KEY (user_id)
      REFERENCES identity.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_external_identities_provider_issuer_subject UNIQUE (provider_key, issuer, subject),
    CONSTRAINT ck_external_identities_provider_key CHECK (provider_key ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
    CONSTRAINT ck_external_identities_issuer CHECK (length(btrim(issuer)) BETWEEN 1 AND 500),
    CONSTRAINT ck_external_identities_subject CHECK (length(btrim(subject)) BETWEEN 1 AND 500),
    CONSTRAINT ck_external_identities_status CHECK (status IN ('ACTIVE','DISABLED')),
    CONSTRAINT ck_external_identities_version CHECK (version >= 1),
    CONSTRAINT ck_external_identities_timestamps CHECK (updated_at >= created_at)
);
CREATE INDEX ix_external_identities_user_status ON identity.external_identities(user_id, status);
COMMENT ON TABLE identity.external_identities IS 'Provider-agnostic mapping from verified external identity to canonical Moventra User. No tokens, passwords or sessions are stored.';
