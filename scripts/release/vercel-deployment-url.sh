#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r line; do
  if [[ "$line" =~ (https://[^[:space:]]+\.vercel\.app) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    exit 0
  fi
done

echo 'could not determine immutable deployment URL from Vercel output' >&2
exit 68
