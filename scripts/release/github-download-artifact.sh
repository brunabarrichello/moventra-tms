#!/usr/bin/env bash
set -euo pipefail

run_id="${1:-}"
match_mode="${2:-}"
selector="${3:-}"
destination="${4:-}"

token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
repo="${GITHUB_REPOSITORY:-}"
api_url="${GITHUB_API_URL:-https://api.github.com}"

fail() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

[[ "$run_id" =~ ^[0-9]+$ ]] || fail 'Artifact run ID must be numeric.'
[[ "$match_mode" == exact || "$match_mode" == prefix ]] || fail 'Artifact match mode must be exact or prefix.'
[[ -n "$selector" ]] || fail 'Artifact selector is required.'
[[ -n "$destination" ]] || fail 'Artifact destination is required.'
[[ -n "$token" ]] || fail 'GH_TOKEN or GITHUB_TOKEN is required.'
[[ "$repo" =~ ^[^/]+/[^/]+$ ]] || fail 'GITHUB_REPOSITORY must be owner/repo.'
command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v jq >/dev/null 2>&1 || fail 'jq is required.'
command -v python3 >/dev/null 2>&1 || fail 'python3 is required.'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum is required.'

headers=(
  -H "Authorization: Bearer ${token}"
  -H 'Accept: application/vnd.github+json'
  -H 'X-GitHub-Api-Version: 2022-11-28'
)

artifacts_json="$(curl --fail --silent --show-error --retry 3 --retry-all-errors \
  --connect-timeout 10 --max-time 60 \
  "${headers[@]}" \
  "${api_url}/repos/${repo}/actions/runs/${run_id}/artifacts?per_page=100")" || \
  fail "Could not list artifacts for workflow run ${run_id}."

total_count="$(jq -r '.total_count // 0' <<< "$artifacts_json")"
[[ "$total_count" =~ ^[0-9]+$ ]] || fail 'Artifact API returned an invalid total_count.'
(( total_count <= 100 )) || fail "Run ${run_id} has more than 100 artifacts; refusing an incomplete first-page selection."

if [[ "$match_mode" == exact ]]; then
  matches="$(jq -c --arg selector "$selector" '[.artifacts[] | select(.expired == false) | select(.name == $selector)]' <<< "$artifacts_json")"
else
  matches="$(jq -c --arg selector "$selector" '[.artifacts[] | select(.expired == false) | select(.name | startswith($selector))]' <<< "$artifacts_json")"
fi

match_count="$(jq 'length' <<< "$matches")"
[[ "$match_count" == 1 ]] || fail "Expected exactly one non-expired artifact for ${match_mode} selector '${selector}' in run ${run_id}; found ${match_count}."

artifact_id="$(jq -r '.[0].id' <<< "$matches")"
artifact_name="$(jq -r '.[0].name' <<< "$matches")"
archive_url="$(jq -r '.[0].archive_download_url' <<< "$matches")"
expected_digest="$(jq -r '.[0].digest // empty' <<< "$matches")"

[[ "$artifact_id" =~ ^[0-9]+$ ]] || fail 'Artifact ID is invalid.'
[[ -n "$artifact_name" ]] || fail 'Artifact name is empty.'
[[ "$archive_url" == "${api_url}/repos/${repo}/actions/artifacts/${artifact_id}/zip" ]] || \
  fail 'Artifact archive_download_url is outside the expected repository API endpoint.'
[[ "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Artifact digest is missing or is not sha256.'

archive_file="$(mktemp "${RUNNER_TEMP:-/tmp}/moventra-artifact-${artifact_id}-XXXXXX.zip")"
cleanup() {
  rm -f "$archive_file"
}
trap cleanup EXIT

curl --fail --location --silent --show-error --retry 3 --retry-all-errors \
  --connect-timeout 10 --max-time 120 \
  "${headers[@]}" \
  "$archive_url" \
  --output "$archive_file" || fail "Could not download artifact ${artifact_name} (${artifact_id})."

expected_sha256="${expected_digest#sha256:}"
actual_sha256="$(sha256sum "$archive_file" | awk '{print $1}')"
[[ "$actual_sha256" == "$expected_sha256" ]] || \
  fail "Artifact archive digest mismatch for ${artifact_name}: expected ${expected_sha256}, got ${actual_sha256}."

rm -rf "$destination"
mkdir -p "$destination"

python3 - "$archive_file" "$destination" <<'PY'
import pathlib
import shutil
import stat
import sys
import zipfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve()

with zipfile.ZipFile(archive) as zf:
    for info in zf.infolist():
        name = info.filename
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts:
            raise SystemExit(f"unsafe artifact archive entry: {name}")

        mode = (info.external_attr >> 16) & 0o170000
        if mode == stat.S_IFLNK:
            raise SystemExit(f"artifact archive symlink is not allowed: {name}")

        target = (destination / pathlib.Path(*path.parts)).resolve()
        if target != destination and destination not in target.parents:
            raise SystemExit(f"artifact archive entry escapes destination: {name}")

        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info, 'r') as source, target.open('wb') as output:
            shutil.copyfileobj(source, output)
PY

printf 'artifact_id=%s\n' "$artifact_id"
printf 'artifact_name=%s\n' "$artifact_name"
printf 'archive_sha256=%s\n' "$actual_sha256"
printf 'destination=%s\n' "$destination"
