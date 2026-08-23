#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 <base-url> <expected-commit-sha>" >&2
  exit 64
fi

base_url="${1%/}"
expected_sha="$2"
if [[ ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid expected commit SHA" >&2
  exit 65
fi

attempts="${SMOKE_ATTEMPTS:-12}"
delay_seconds="${SMOKE_DELAY_SECONDS:-5}"
auth_mode="${SMOKE_AUTH_MODE:-auto}"
vercel_cli_version="${VERCEL_CLI_VERSION:-59.4.0}"

case "$auth_mode" in
  auto|http|vercel) ;;
  *) echo "invalid SMOKE_AUTH_MODE: $auth_mode" >&2; exit 66 ;;
esac

validate_database_health() {
  local response="$1"
  printf '%s' "$response" | EXPECTED_SHA="$expected_sha" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    let payload;
    try {
      payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      process.exit(1);
    }
    if (payload.status !== "ready") process.exit(1);
    if (payload.service !== "database") process.exit(1);
    if (payload.version !== process.env.EXPECTED_SHA) process.exit(1);
  '
}

fetch_http() {
  curl --fail --silent --show-error --max-time 20 "${base_url}/api/database-health" 2>/dev/null || true
}

fetch_vercel() {
  : "${VERCEL_TOKEN:?VERCEL_TOKEN is required for authenticated Vercel smoke}"
  : "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required for authenticated Vercel smoke}"
  : "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required for authenticated Vercel smoke}"

  local workdir
  workdir="$(mktemp -d)"
  mkdir -p "$workdir/.vercel"
  cat > "$workdir/.vercel/project.json" <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_PROJECT_ID}"}
EOF

  (
    cd "$workdir"
    NPM_CONFIG_LOGLEVEL=error \
    NO_UPDATE_NOTIFIER=1 \
    VERCEL_TELEMETRY_DISABLED=1 \
      npx --yes "vercel@${vercel_cli_version}" \
        curl "${base_url}/api/database-health" || true
  )
  rm -rf "$workdir"
}

for ((attempt=1; attempt<=attempts; attempt++)); do
  if [[ "$auth_mode" != vercel ]]; then
    response="$(fetch_http)"
    if validate_database_health "$response"; then
      echo "database health smoke passed (http): ${base_url} @ ${expected_sha}"
      exit 0
    fi
  fi

  if [[ "$auth_mode" != http && -n "${VERCEL_TOKEN:-}" && -n "${VERCEL_ORG_ID:-}" && -n "${VERCEL_PROJECT_ID:-}" ]]; then
    response="$(fetch_vercel)"
    if validate_database_health "$response"; then
      echo "database health smoke passed (vercel): ${base_url} @ ${expected_sha}"
      exit 0
    fi
  fi

  if [[ "$attempt" -lt "$attempts" ]]; then
    sleep "$delay_seconds"
  fi
done

echo "database health smoke failed after ${attempts} attempts (${auth_mode}): ${base_url} expected ${expected_sha}" >&2
exit 70
