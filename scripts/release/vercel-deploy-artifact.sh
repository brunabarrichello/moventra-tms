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
: "${VERCEL_PROJECT_NAME:?VERCEL_PROJECT_NAME is required}"

metadata="$(bash "$ROOT/scripts/release/artifact-metadata.sh" "$artifact_dir")"
commit_sha="$(printf '%s\n' "$metadata" | awk -F= '$1=="commit_sha" {print $2}')"
artifact_sha256="$(printf '%s\n' "$metadata" | awk -F= '$1=="artifact_sha256" {print $2}')"
mapfile -t tarballs < <(find "$artifact_dir" -maxdepth 1 -type f -name 'moventra-tms-*.tar.gz' -print | sort)
tarball="${tarballs[0]}"

case "$VERCEL_PROJECT_NAME" in
  moventra-tms-staging) auth_environment=staging ;;
  moventra-tms) auth_environment=production ;;
  *)
    echo "::error::Unsupported Vercel project for governed JWT trust synchronization: ${VERCEL_PROJECT_NAME}" >&2
    exit 1
    ;;
esac

auth_sync="$(bash "$ROOT/scripts/release/sync-auth-env-to-vercel.sh" "$auth_environment")"
printf '%s\n' "$auth_sync" >&2
auth_provider_key="$(printf '%s\n' "$auth_sync" | awk -F= '$1=="provider_key" {print $2}')"
auth_algorithm="$(printf '%s\n' "$auth_sync" | awk -F= '$1=="algorithm" {print $2}')"
auth_kid="$(printf '%s\n' "$auth_sync" | awk -F= '$1=="kid" {print $2}')"
auth_public_key_sha256="$(printf '%s\n' "$auth_sync" | awk -F= '$1=="public_key_sha256" {print $2}')"
test -n "$auth_provider_key"
test -n "$auth_algorithm"
test -n "$auth_kid"
[[ "$auth_public_key_sha256" =~ ^[0-9a-f]{64}$ ]]

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
tar -xzf "$tarball" -C "$workdir"

mkdir -p "$workdir/.vercel"
cat > "$workdir/.vercel/project.json" <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_PROJECT_ID}"}
EOF

vercel_cli_version="${VERCEL_CLI_VERSION:-59.4.0}"
cd "$workdir"
# A fresh prebuilt deployment is created from the immutable artifact. Runtime
# secrets remain owned by Vercel Project Settings and are never copied through
# GitHub Actions, command arguments or generated dotenv files.
deployment_output="$(NPM_CONFIG_LOGLEVEL=error NO_UPDATE_NOTIFIER=1 VERCEL_TELEMETRY_DISABLED=1 npx --yes "vercel@${vercel_cli_version}" deploy --prebuilt --prod --yes --token "$VERCEL_TOKEN" 2>&1)"
printf '%s\n' "$deployment_output" >&2

# Vercel prints the immutable production deployment before any stable alias.
# Parse the first *.vercel.app URL deterministically so later aliases cannot
# replace the exact deployment identity used by revision-aware smoke tests.
deployment_url="$(printf '%s\n' "$deployment_output" | bash "$ROOT/scripts/release/vercel-deployment-url.sh")"

printf 'deployment_url=%s\n' "$deployment_url"
printf 'commit_sha=%s\n' "$commit_sha"
printf 'artifact_sha256=%s\n' "$artifact_sha256"
printf 'auth_provider_key=%s\n' "$auth_provider_key"
printf 'auth_algorithm=%s\n' "$auth_algorithm"
printf 'auth_kid=%s\n' "$auth_kid"
printf 'auth_public_key_sha256=%s\n' "$auth_public_key_sha256"
