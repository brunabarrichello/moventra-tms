#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_NAME:?VERCEL_PROJECT_NAME is required}"

VERCEL_NODE_VERSION="${VERCEL_NODE_VERSION:-22.x}"
api="https://api.vercel.com"
auth="Authorization: Bearer ${VERCEL_TOKEN}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

project_url="${api}/v9/projects/${VERCEL_PROJECT_NAME}?teamId=${VERCEL_ORG_ID}"
status="$(curl --silent --show-error --output "$workdir/project.json" --write-out '%{http_code}' \
  --header "$auth" \
  "$project_url")"

if [[ "$status" == "404" ]]; then
  node --input-type=module - "$VERCEL_PROJECT_NAME" > "$workdir/create-project.json" <<'NODE'
const [name] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({ name })}\n`);
NODE

  curl --fail --silent --show-error \
    --request POST \
    --url "${api}/v11/projects?teamId=${VERCEL_ORG_ID}" \
    --header "$auth" \
    --header 'Content-Type: application/json' \
    --data-binary @"$workdir/create-project.json" \
    > "$workdir/project.json"
elif [[ "$status" != "200" ]]; then
  echo "::error::Unable to resolve Vercel project ${VERCEL_PROJECT_NAME} (HTTP ${status})" >&2
  exit 1
fi

project_id="$(node --input-type=module - "$workdir/project.json" "$VERCEL_PROJECT_NAME" <<'NODE'
import fs from 'node:fs';
const [file, expectedName] = process.argv.slice(2);
const project = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!project.id || project.name !== expectedName) process.exit(2);
process.stdout.write(project.id);
NODE
)"

node --input-type=module - "$VERCEL_NODE_VERSION" > "$workdir/project-policy.json" <<'NODE'
const [nodeVersion] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({
  nodeVersion,
  autoExposeSystemEnvs: false,
  directoryListing: false,
  previewDeploymentsDisabled: true,
  resourceConfig: { fluid: true },
})}\n`);
NODE

curl --fail --silent --show-error \
  --request PATCH \
  --url "${api}/v9/projects/${project_id}?teamId=${VERCEL_ORG_ID}" \
  --header "$auth" \
  --header 'Content-Type: application/json' \
  --data-binary @"$workdir/project-policy.json" \
  > "$workdir/project-updated.json"

node --input-type=module - "$workdir/project-updated.json" "$VERCEL_PROJECT_NAME" "$VERCEL_NODE_VERSION" <<'NODE'
import fs from 'node:fs';
const [file, expectedName, expectedNode] = process.argv.slice(2);
const project = JSON.parse(fs.readFileSync(file, 'utf8'));
const failures = [];
if (project.name !== expectedName) failures.push(`name=${project.name}`);
if (project.nodeVersion !== expectedNode) failures.push(`nodeVersion=${project.nodeVersion}`);
if (project.directoryListing !== false) failures.push(`directoryListing=${project.directoryListing}`);
if (project.previewDeploymentsDisabled !== true) failures.push(`previewDeploymentsDisabled=${project.previewDeploymentsDisabled}`);
if (project.resourceConfig?.fluid !== true) failures.push(`resourceConfig.fluid=${project.resourceConfig?.fluid}`);
if (failures.length) {
  console.error(`::error::Vercel project policy did not converge: ${failures.join(', ')}`);
  process.exit(1);
}
NODE

printf 'project_id=%s\n' "$project_id"
printf 'project_name=%s\n' "$VERCEL_PROJECT_NAME"
printf 'node_version=%s\n' "$VERCEL_NODE_VERSION"
