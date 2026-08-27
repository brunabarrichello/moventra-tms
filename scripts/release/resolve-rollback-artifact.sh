#!/usr/bin/env bash
set -euo pipefail

restore_sha="${1:-}"
max_ancestors="${2:-50}"
token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
repo="${GITHUB_REPOSITORY:-}"
api_url="${GITHUB_API_URL:-https://api.github.com}"

fail() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

[[ "$restore_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Restore SHA must be a full lowercase hexadecimal commit SHA.'
[[ "$max_ancestors" =~ ^[1-9][0-9]*$ ]] || fail 'Maximum ancestor depth must be a positive integer.'
(( max_ancestors <= 200 )) || fail 'Maximum ancestor depth may not exceed 200.'
[[ -n "$token" ]] || fail 'GH_TOKEN or GITHUB_TOKEN is required.'
[[ "$repo" =~ ^[^/]+/[^/]+$ ]] || fail 'GITHUB_REPOSITORY must be owner/repo.'
command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v jq >/dev/null 2>&1 || fail 'jq is required.'

headers=(
  -H "Authorization: Bearer ${token}"
  -H 'Accept: application/vnd.github+json'
  -H 'X-GitHub-Api-Version: 2022-11-28'
)

api_get() {
  curl --fail --silent --show-error --retry 3 --retry-all-errors \
    --connect-timeout 10 --max-time 60 \
    "${headers[@]}" "$1"
}

current="$restore_sha"
for (( depth=1; depth<=max_ancestors; depth++ )); do
  commit_json="$(api_get "${api_url}/repos/${repo}/commits/${current}")" || \
    fail "Could not read commit ${current}."
  parent_count="$(jq '.parents | length' <<< "$commit_json")"
  [[ "$parent_count" =~ ^[0-9]+$ ]] || fail "Commit ${current} returned an invalid parent count."
  (( parent_count == 1 )) || fail "Rollback ancestry must remain linear; commit ${current} has ${parent_count} parents."

  candidate="$(jq -r '.parents[0].sha' <<< "$commit_json")"
  [[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || fail "Commit ${current} has an invalid parent SHA."
  artifact_name="moventra-tms-${candidate}"

  artifacts_json="$(api_get "${api_url}/repos/${repo}/actions/artifacts?name=${artifact_name}&per_page=100")" || \
    fail "Could not list artifacts for rollback candidate ${candidate}."
  artifact_count="$(jq -r '.total_count // 0' <<< "$artifacts_json")"
  [[ "$artifact_count" =~ ^[0-9]+$ ]] || fail 'Artifact API returned an invalid total_count.'
  (( artifact_count <= 100 )) || fail "Artifact lookup for ${candidate} exceeds one API page; refusing ambiguous selection."

  candidate_run_id="$(jq -r \
    --arg name "$artifact_name" \
    --arg sha "$candidate" \
    '[.artifacts[]
      | select(.name == $name)
      | select(.expired == false)
      | select(.workflow_run.head_branch == "main")
      | select(.workflow_run.head_sha == $sha)]
     | sort_by(.created_at)
     | last
     | .workflow_run.id // empty' <<< "$artifacts_json")"

  if [[ "$candidate_run_id" =~ ^[0-9]+$ ]]; then
    run_json="$(api_get "${api_url}/repos/${repo}/actions/runs/${candidate_run_id}")" || \
      fail "Could not validate artifact source run ${candidate_run_id}."
    run_name="$(jq -r '.name // empty' <<< "$run_json")"
    run_conclusion="$(jq -r '.conclusion // empty' <<< "$run_json")"
    run_branch="$(jq -r '.head_branch // empty' <<< "$run_json")"
    run_sha="$(jq -r '.head_sha // empty' <<< "$run_json")"
    if [[ "$run_name" == 'Moventra CI' && "$run_conclusion" == success && "$run_branch" == main && "$run_sha" == "$candidate" ]]; then
      printf 'rollback_run_id=%s\n' "$candidate_run_id"
      printf 'rollback_artifact_name=%s\n' "$artifact_name"
      printf 'rollback_sha=%s\n' "$candidate"
      printf 'rollback_ancestor_depth=%s\n' "$depth"
      exit 0
    fi
    printf 'Ignoring candidate %s at depth %s: artifact source run is not a successful Moventra CI main run.\n' "$candidate" "$depth" >&2
  else
    printf 'No eligible immutable main artifact for ancestor %s at depth %s; continuing.\n' "$candidate" "$depth" >&2
  fi

  current="$candidate"
done

fail "No non-expired rollback artifact from a successful Moventra CI main run was found within ${max_ancestors} ancestors of ${restore_sha}."
