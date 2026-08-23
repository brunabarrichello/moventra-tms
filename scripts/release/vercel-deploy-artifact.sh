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

vercel_cli_version="${VERCEL_CLI_VERSION:-59.4.0}"
export VERCEL_TOKEN

cat > "$workdir/deploy-prebuilt.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required in the Vercel production environment}"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"

# DATABASE_URL is intentionally obtained at execution time from the linked
# Vercel project and never written into the immutable application artifact.
# Mask it in GitHub Actions before the CLI receives it as a runtime variable.
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  printf '::add-mask::%s\n' "$DATABASE_URL"
fi

exec vercel deploy \
  --prebuilt \
  --prod \
  --yes \
  --token "$VERCEL_TOKEN" \
  --env "DATABASE_URL=${DATABASE_URL}"
EOF
chmod 700 "$workdir/deploy-prebuilt.sh"

cd "$workdir"
# `vercel env run` reads the current Production environment from the linked
# project without persisting it to a dotenv file. The child deployment then
# explicitly receives DATABASE_URL as a runtime variable, which is required
# for fresh prebuilt deployments after Project Settings/Environment changes.
deployment_output="$(
  NPM_CONFIG_LOGLEVEL=error \
  NO_UPDATE_NOTIFIER=1 \
  VERCEL_TELEMETRY_DISABLED=1 \
  npx --yes "vercel@${vercel_cli_version}" env run \
    --environment=production \
    --token "$VERCEL_TOKEN" \
    -- ./deploy-prebuilt.sh \
    2>&1
)"
printf '%s\n' "$deployment_output" >&2

# Vercel prints the immutable production deployment before any stable alias.
# Parse the first *.vercel.app URL deterministically so later aliases cannot
# replace the exact deployment identity used by revision-aware smoke tests.
deployment_url="$(printf '%s\n' "$deployment_output" | bash "$ROOT/scripts/release/vercel-deployment-url.sh")"

printf 'deployment_url=%s\n' "$deployment_url"
printf 'commit_sha=%s\n' "$commit_sha"
printf 'artifact_sha256=%s\n' "$artifact_sha256"
