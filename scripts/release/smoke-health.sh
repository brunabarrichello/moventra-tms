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
auth_mode="${SMOKE_AUTH_MODE:-http}"
vercel_cli_version="${VERCEL_CLI_VERSION:-59.3.0}"

case "$auth_mode" in
  http|vercel) ;;
  *)
    echo "invalid SMOKE_AUTH_MODE: $auth_mode" >&2
    exit 66
    ;;
esac

fetch_health() {
  if [[ "$auth_mode" == http ]]; then
    curl --fail --silent --show-error --location --max-time 20 "${base_url}/health" 2>/dev/null || true
    return
  fi

  : "${VERCEL_TOKEN:?VERCEL_TOKEN is required for SMOKE_AUTH_MODE=vercel}"
  : "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required for SMOKE_AUTH_MODE=vercel}"
  : "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required for SMOKE_AUTH_MODE=vercel}"

  local workdir
  workdir="$(mktemp -d)"
  mkdir -p "$workdir/.vercel"
  cat > "$workdir/.vercel/project.json" <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_PROJECT_ID}"}
EOF

  (
    cd "$workdir"
    npx --yes "vercel@${vercel_cli_version}" \
      --token "$VERCEL_TOKEN" \
      curl /health \
      --deployment "$base_url" \
      2>/dev/null || true
  )
  rm -rf "$workdir"
}

for ((attempt=1; attempt<=attempts; attempt++)); do
  response="$(fetch_health)"
  if RESPONSE="$response" EXPECTED_SHA="$expected_sha" node --input-type=module <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || '{}');
if (payload.status !== 'ok') process.exit(1);
if (payload.product !== 'Moventra TMS') process.exit(1);
if (payload.service !== 'moventra-api') process.exit(1);
if (payload.version !== process.env.EXPECTED_SHA) process.exit(1);
NODE
  then
    echo "health smoke passed (${auth_mode}): ${base_url} @ ${expected_sha}"
    exit 0
  fi

  if [[ "$attempt" -lt "$attempts" ]]; then
    sleep "$delay_seconds"
  fi
done

echo "health smoke failed after ${attempts} attempts (${auth_mode}): ${base_url} expected ${expected_sha}" >&2
exit 69
