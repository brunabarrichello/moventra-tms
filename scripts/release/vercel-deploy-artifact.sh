#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 <artifact-directory>" >&2
  exit 64
fi

ROOT="$(git rev-parse --show-toplevel)"
artifact_dir="$1"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"

metadata="$(bash "$ROOT/scripts/release/artifact-metadata.sh" "$artifact_dir")"
commit_sha="$(printf '%s\n' "$metadata" | awk -F= '$1=="commit_sha" {print $2}')"
artifact_sha256="$(printf '%s\n' "$metadata" | awk -F= '$1=="artifact_sha256" {print $2}')"
mapfile -t tarballs < <(find "$artifact_dir" -maxdepth 1 -type f -name 'moventra-tms-*.tar.gz' -print | sort)
tarball="${tarballs[0]}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
tar -xzf "$tarball" -C "$workdir"

mkdir -p "$workdir/.vercel"
cat > "$workdir/.vercel/project.json" <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_PROJECT_ID}"}
EOF

vercel_cli_version="${VERCEL_CLI_VERSION:-59.3.0}"
cd "$workdir"
deployment_output="$(npx --yes "vercel@${vercel_cli_version}" deploy --prebuilt --prod --yes --token "$VERCEL_TOKEN" 2>&1)"
printf '%s\n' "$deployment_output" >&2

# Vercel prints the immutable production deployment before any stable alias.
# Parse the first *.vercel.app URL deterministically so later aliases cannot
# replace the exact deployment identity used by revision-aware smoke tests.
deployment_url="$(printf '%s\n' "$deployment_output" | bash "$ROOT/scripts/release/vercel-deployment-url.sh")"

printf 'deployment_url=%s\n' "$deployment_url"
printf 'commit_sha=%s\n' "$commit_sha"
printf 'artifact_sha256=%s\n' "$artifact_sha256"
