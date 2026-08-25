-- Moventra TMS — Validation 0012: runtime PostgreSQL access contract
-- This validation intentionally creates synthetic non-owner roles only in the validation database.
-- Production/staging roles are never created or modified by application migrations.

\set ON_ERROR_STOP on
\set runtime_role moventra_runtime_ci
\set app_role moventra_app_ci

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moventra_runtime_ci') THEN
    CREATE ROLE moventra_runtime_ci
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moventra_app_ci') THEN
    CREATE ROLE moventra_app_ci
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  GRANT moventra_runtime_ci TO moventra_app_ci;
END
$roles$;

\ir ../runtime/runtime-access.sql
\ir ../runtime/runtime-access-validation.sql
