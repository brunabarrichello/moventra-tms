#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

readonly RUNTIME_ROLE='moventra_runtime_ci'
readonly APP_ROLE='moventra_app_ci'

psql -X --no-psqlrc -v ON_ERROR_STOP=1 <<'SQL'
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
SQL

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v runtime_role="$RUNTIME_ROLE" \
  -f db/runtime/runtime-access.sql

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v runtime_role="$RUNTIME_ROLE" \
  -v app_role="$APP_ROLE" \
  -f db/runtime/runtime-access-validation.sql

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v runtime_role="$RUNTIME_ROLE" \
  -v app_role="$APP_ROLE" \
  -f db/runtime/idempotency-runtime-access-validation.sql

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v runtime_role="$RUNTIME_ROLE" \
  -v app_role="$APP_ROLE" \
  -f db/runtime/outbox-runtime-access-validation.sql

psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
  -v runtime_role="$RUNTIME_ROLE" \
  -v app_role="$APP_ROLE" \
  -f db/runtime/jobs-runtime-access-validation.sql

node scripts/db/validate-outbox-concurrency.mjs
node scripts/db/validate-jobs-concurrency.mjs

echo "Runtime PostgreSQL access contract passed for synthetic non-owner principal ${APP_ROLE}, including Transactional Outbox and Durable Jobs."
