#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 <upstream-run-id> <artifact-prefix>" >&2
  exit 64
fi

run_id="$1"
artifact_prefix="$2"

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

[[ "$run_id" =~ ^[0-9]+$ ]] || {
  echo '::error::Invalid upstream workflow run ID.' >&2
  exit 65
}
test -n "$artifact_prefix" || {
  echo '::error::Artifact prefix is required.' >&2
  exit 66
}

artifacts_json="$(curl --fail --silent --show-error \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100")"

matching_count="$(jq \
  --arg prefix "$artifact_prefix" \
  '[.artifacts[] | select(.expired == false) | select(.name | startswith($prefix))] | length' \
  <<< "$artifacts_json")"

case "$matching_count" in
  0)
    printf 'requires_release=false\n'
    printf 'classification=upstream-no-release-evidence\n'
    ;;
  1)
    printf 'requires_release=true\n'
    printf 'classification=upstream-release-evidence\n'
    ;;
  *)
    echo "::error::Expected at most one non-expired upstream release evidence artifact with prefix ${artifact_prefix}; found ${matching_count}." >&2
    exit 67
    ;;
esac