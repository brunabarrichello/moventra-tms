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

status="$(curl --silent --show-error \
  --output "$workdir/response.json" \
  --write-out '%{http_code}' \
  --request POST \
  --url "https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true&teamId=${VERCEL_ORG_ID}" \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data-binary @"$workdir/env.json")"

if [[ "$status" != "200" && "$status" != "201" ]]; then
  echo "::error::Unable to upsert ${VERCEL_ENV_KEY} in Vercel (HTTP ${status})" >&2
  exit 1
fi

# Never print the API response: it may contain secret material.
printf 'env_key=%s\n' "$VERCEL_ENV_KEY"
printf 'env_target=%s\n' "$VERCEL_ENV_TARGET"
printf 'result=upserted\n'
