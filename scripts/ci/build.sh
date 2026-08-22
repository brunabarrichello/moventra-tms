#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

COMMIT_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$COMMIT_SHA" 2>/dev/null || git show -s --format=%ct HEAD)"
ARTIFACT_NAME="moventra-tms-${COMMIT_SHA}.tar.gz"

rm -rf dist
mkdir -p dist/app dist/artifacts
cp -R src api dist/app/
cp package.json vercel.json dist/app/

cat > dist/app/build-manifest.json <<EOF
{
  "product": "Moventra TMS",
  "service": "moventra-api",
  "commit_sha": "${COMMIT_SHA}",
  "artifact": "${ARTIFACT_NAME}"
}
EOF

node --check dist/app/src/server.js

tar \
  --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C dist/app \
  -cf - . | gzip -n > "dist/artifacts/${ARTIFACT_NAME}"

sha256sum "dist/artifacts/${ARTIFACT_NAME}" > "dist/artifacts/${ARTIFACT_NAME}.sha256"
cat "dist/artifacts/${ARTIFACT_NAME}.sha256"
