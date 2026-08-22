#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

COMMIT_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
if [[ ! "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid commit SHA: $COMMIT_SHA" >&2
  exit 64
fi

SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$COMMIT_SHA" 2>/dev/null || git show -s --format=%ct HEAD)"
ARTIFACT_NAME="moventra-tms-${COMMIT_SHA}.tar.gz"
PACKAGE_ROOT="dist/package"
OUTPUT_ROOT="$PACKAGE_ROOT/.vercel/output"

rm -rf dist
mkdir -p "$PACKAGE_ROOT" dist/artifacts
node scripts/ci/build-vercel-output.mjs "$OUTPUT_ROOT" "$COMMIT_SHA"

cat > "$PACKAGE_ROOT/build-manifest.json" <<EOF
{
  "schema_version": 1,
  "product": "Moventra TMS",
  "service": "moventra-api",
  "commit_sha": "${COMMIT_SHA}",
  "artifact": "${ARTIFACT_NAME}",
  "artifact_format": "vercel-build-output-v3",
  "build_output_api_version": 3,
  "runtime": "nodejs22.x"
}
EOF

node --check "$OUTPUT_ROOT/functions/api/health.func/index.js"
node --check "$OUTPUT_ROOT/functions/api/database-health.func/index.js"
node --input-type=module -e "await import('./dist/package/.vercel/output/functions/api/database-health.func/index.js')"

tar \
  --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "$PACKAGE_ROOT" \
  -cf - . | gzip -n > "dist/artifacts/${ARTIFACT_NAME}"

(
  cd dist/artifacts
  sha256sum "${ARTIFACT_NAME}" > "${ARTIFACT_NAME}.sha256"
  sha256sum -c "${ARTIFACT_NAME}.sha256"
)

bash scripts/release/artifact-metadata.sh dist/artifacts
