#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

readonly WORKER_ROLE='moventra_worker_runtime_ci'
readonly WORKER_APP_ROLE='moventra_worker_app_ci'

psql -X --no-psqlrc -v ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moventra_worker_runtime_ci') THEN
    CREATE ROLE moventra_worker_runtime_ci
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moventra_worker_app_ci') THEN
    CREATE ROLE moventra_worker_app_ci
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  GRANT moventra_worker_runtime_ci TO moventra_worker_app_ci;
END
$roles$;
SQL

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v worker_role="$WORKER_ROLE" \
  -f db/runtime/worker-access.sql

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v worker_role="$WORKER_ROLE" \
  -v worker_app_role="$WORKER_APP_ROLE" \
  -f db/runtime/worker-access-validation.sql

echo "Dedicated PostgreSQL worker least-privilege contract passed for ${WORKER_APP_ROLE}."
