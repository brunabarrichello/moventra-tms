#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"
: "${VERCEL_ENV_KEY:?VERCEL_ENV_KEY is required}"
: "${VERCEL_ENV_VALUE:?VERCEL_ENV_VALUE is required}"

VERCEL_ENV_TARGET="${VERCEL_ENV_TARGET:-production}"
VERCEL_ENV_COMMENT="${VERCEL_ENV_COMMENT:-Managed by Moventra release automation}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
chmod 700 "$workdir"

node --input-type=module > "$workdir/env.json" <<'NODE'
const payload = [{
  key: process.env.VERCEL_ENV_KEY,
  value: process.env.VERCEL_ENV_VALUE,
  type: 'sensitive',
  target: [process.env.VERCEL_ENV_TARGET ?? 'production'],
  comment: process.env.VERCEL_ENV_COMMENT ?? 'Managed by Moventra release automation',
}];
process.stdout.write(`${JSON.stringify(payload)}\n`);
NODE
chmod 600 "$workdir/env.json"

upsert_env() {
  local url="$1"
  local output="$2"
  curl --silent --show-error \
    --output "$output" \
    --write-out '%{http_code}' \
    --request POST \
    --url "$url" \
    --header "Authorization: Bearer ${VERCEL_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data-binary @"$workdir/env.json"
}

explicit_url="https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true&teamId=${VERCEL_ORG_ID}"
inferred_url="https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true"

status="$(upsert_env "$explicit_url" "$workdir/response.json")"
auth_context="explicit"

# Scoped Vercel tokens can infer their own team/project context. Retry only on
# authorization failure; upsert=true keeps the operation idempotent and the
# response body is never printed because it may contain sensitive material.
if [[ "$status" == "403" ]]; then
  status="$(upsert_env "$inferred_url" "$workdir/response-inferred.json")"
  auth_context="inferred"
fi

if [[ "$status" == "401" ]]; then
  echo "::error::Vercel token is invalid or expired while upserting ${VERCEL_ENV_KEY}" >&2
  exit 1
fi

if [[ "$status" != "200" && "$status" != "201" ]]; then
  echo "::error::Unable to upsert ${VERCEL_ENV_KEY} in Vercel (HTTP ${status}, auth_context=${auth_context}); verify that the token grants access to project ${VERCEL_PROJECT_ID}" >&2
  exit 1
fi

# Never print the API response: it may contain secret material.
printf 'env_key=%s\n' "$VERCEL_ENV_KEY"
printf 'env_target=%s\n' "$VERCEL_ENV_TARGET"
printf 'auth_context=%s\n' "$auth_context"
printf 'result=upserted\n'
