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

for ((attempt=1; attempt<=attempts; attempt++)); do
  response="$(curl --fail --silent --show-error --location --max-time 20 "${base_url}/health" 2>/dev/null || true)"
  if RESPONSE="$response" EXPECTED_SHA="$expected_sha" node --input-type=module <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || '{}');
if (payload.status !== 'ok') process.exit(1);
if (payload.product !== 'Moventra TMS') process.exit(1);
if (payload.service !== 'moventra-api') process.exit(1);
if (payload.version !== process.env.EXPECTED_SHA) process.exit(1);
NODE
  then
    echo "health smoke passed: ${base_url} @ ${expected_sha}"
    exit 0
  fi

  if [[ "$attempt" -lt "$attempts" ]]; then
    sleep "$delay_seconds"
  fi
done

echo "health smoke failed after ${attempts} attempts: ${base_url} expected ${expected_sha}" >&2
exit 69
