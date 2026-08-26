#!/usr/bin/env bash
set -euo pipefail

: "${MIGRATIONS_DATABASE_URL:?MIGRATIONS_DATABASE_URL is required for governed database migration promotion}"

# Runtime credentials must never be promoted to DDL authority. The existing migration
# runner consumes DATABASE_URL internally, so scope it only to this process from the
# protected migration credential. MIGRATIONS_DATABASE_URL must never be synchronized
# to Vercel, Railway or any application runtime.
export DATABASE_URL="$MIGRATIONS_DATABASE_URL"

mapfile -t migration_files < <(find db/migrations -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -print | sort)
test "${#migration_files[@]}" -gt 0 || {
  echo '::error::No versioned database migrations were found.' >&2
  exit 70
}

latest_file="${migration_files[-1]}"
latest_name="$(basename "$latest_file")"
latest_version="${latest_name%%_*}"
latest_checksum="$(sha256sum "$latest_file" | awk '{print $1}')"

[[ "$latest_version" =~ ^[0-9]{4}$ ]] || {
  echo "::error::Invalid latest migration version: ${latest_version}" >&2
  exit 71
}
[[ "$latest_checksum" =~ ^[0-9a-f]{64}$ ]] || {
  echo '::error::Could not calculate latest migration checksum.' >&2
  exit 72
}

before="$(node scripts/db/migrate.mjs --status)"
printf '%s\n' "$before"

node scripts/db/migrate.mjs

after="$(node scripts/db/migrate.mjs --status)"
printf '%s\n' "$after"

if grep -q ' pending:' <<< "$after"; then
  echo '::error::Database still has pending migrations after governed promotion.' >&2
  exit 73
fi

grep -Fq "migration $((10#$latest_version)) already applied: ${latest_name}" <<< "$after" || {
  echo "::error::Latest migration ${latest_name} is not recorded as applied." >&2
  exit 74
}

{
  printf 'database_migration_max=%s\n' "$latest_version"
  printf 'database_migration_name=%s\n' "$latest_name"
  printf 'database_migration_checksum=%s\n' "$latest_checksum"
}