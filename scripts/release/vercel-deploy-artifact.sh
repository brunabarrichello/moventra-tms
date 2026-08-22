#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 <artifact-directory>" >&2
  exit 64
fi

artifact_dir="$1"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_STAGING_PROJECT_ID:?VERCEL_STAGING_PROJECT_ID is required}"

mapfile -t tarballs < <(find "$artifact_dir" -maxdepth 1 -type f -name 'moventra-tms-*.tar.gz' -print | sort)
mapfile -t checksum_files < <(find "$artifact_dir" -maxdepth 1 -type f -name 'moventra-tms-*.tar.gz.sha256' -print | sort)

if [[ "${#tarballs[@]}" -ne 1 || "${#checksum_files[@]}" -ne 1 ]]; then
  echo "artifact directory must contain exactly one tarball and one SHA-256 file" >&2
  exit 65
fi

tarball="${tarballs[0]}"
checksum_file="${checksum_files[0]}"
expected_sha="$(awk 'NF {print $1; exit}' "$checksum_file")"
actual_sha="$(sha256sum "$tarball" | awk '{print $1}')"

if [[ -z "$expected_sha" || "$expected_sha" != "$actual_sha" ]]; then
  echo "artifact checksum validation failed" >&2
  echo "expected=${expected_sha:-missing}" >&2
  echo "actual=$actual_sha" >&2
  exit 66
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

tar -xzf "$tarball" -C "$workdir"

manifest="$workdir/build-manifest.json"
if [[ ! -f "$manifest" ]]; then
  echo "build-manifest.json is missing from immutable artifact" >&2
  exit 67
fi

node --input-type=module - "$manifest" <<'NODE'
import fs from 'node:fs';

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.product !== 'Moventra TMS') throw new Error('unexpected product in manifest');
if (manifest.service !== 'moventra-api') throw new Error('unexpected service in manifest');
if (!/^[0-9a-f]{40}$/.test(manifest.commit_sha)) throw new Error('invalid commit SHA in manifest');
if (!/^moventra-tms-[0-9a-f]{40}\.tar\.gz$/.test(manifest.artifact)) throw new Error('invalid artifact name in manifest');
NODE

mkdir -p "$workdir/.vercel"
cat > "$workdir/.vercel/project.json" <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_STAGING_PROJECT_ID}"}
EOF

vercel_cli_version="${VERCEL_CLI_VERSION:-59.3.0}"
cd "$workdir"
deployment_output="$(npx --yes "vercel@${vercel_cli_version}" deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1)"
echo "$deployment_output" >&2

deployment_url="$(printf '%s\n' "$deployment_output" | grep -Eo 'https://[^[:space:]]+\.vercel\.app' | tail -1)"
if [[ -z "$deployment_url" ]]; then
  echo "could not determine deployment URL from Vercel output" >&2
  exit 68
fi

printf '%s\n' "$deployment_url"
