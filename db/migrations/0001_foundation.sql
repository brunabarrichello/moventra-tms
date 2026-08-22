-- Moventra TMS — Migration 0001: Database Foundation
-- Phase: 006 — Banco Base
-- PostgreSQL 18+
-- Scope: infrastructure metadata only.
-- IMPORTANT: domain entities belong to later official phases and must not be created here.

CREATE TABLE IF NOT EXISTS moventra_meta.database_contract (
    id SMALLINT PRIMARY KEY,
    product TEXT NOT NULL,
    technical_name TEXT NOT NULL,
    contract_version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_database_contract_singleton CHECK (id = 1),
    CONSTRAINT ck_database_contract_version_positive CHECK (contract_version > 0)
);

INSERT INTO moventra_meta.database_contract (
    id,
    product,
    technical_name,
    contract_version
)
VALUES (
    1,
    'Moventra TMS',
    'moventra-tms',
    1
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON SCHEMA moventra_meta IS
    'Moventra TMS internal database metadata. Business-domain objects are forbidden in phase 006.';

COMMENT ON TABLE moventra_meta.database_contract IS
    'Singleton record identifying the database foundation contract version.';
