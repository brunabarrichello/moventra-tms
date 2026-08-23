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

request_project() {
  local url="$1"
  local output="$2"
  curl --silent --show-error \
    --output "$output" \
    --write-out '%{http_code}' \
    --header "$auth" \
    "$url"
}

explicit_project_url="${api}/v9/projects/${VERCEL_PROJECT_NAME}?teamId=${VERCEL_ORG_ID}"
inferred_project_url="${api}/v9/projects/${VERCEL_PROJECT_NAME}"

status="$(request_project "$explicit_project_url" "$workdir/project.json")"
scope_mode="explicit"

# Vercel scoped tokens can infer team/project context and may reject an explicit
# teamId. On authorization/not-found responses, retry once without teamId. This
# does not weaken authorization; it only lets Vercel evaluate the token's own
# scope. Never print the response body because provider responses may contain
# account metadata that is unnecessary for CI logs.
if [[ "$status" == "403" || "$status" == "404" ]]; then
  inferred_status="$(request_project "$inferred_project_url" "$workdir/project-inferred.json")"
  if [[ "$inferred_status" == "200" ]]; then
    mv "$workdir/project-inferred.json" "$workdir/project.json"
    status="200"
    scope_mode="inferred"
  elif [[ "$status" == "403" ]]; then
    if [[ "$inferred_status" == "401" ]]; then
      echo "::error::Vercel token is invalid or expired (HTTP 401 while resolving ${VERCEL_PROJECT_NAME})" >&2
    else
      echo "::error::Vercel token does not grant access to project ${VERCEL_PROJECT_NAME}; explicit team scope returned HTTP 403 and token-inferred scope returned HTTP ${inferred_status}" >&2
    fi
    exit 1
  fi
fi

if [[ "$status" == "401" ]]; then
  echo "::error::Vercel token is invalid or expired (HTTP 401 while resolving ${VERCEL_PROJECT_NAME})" >&2
  exit 1
fi

if [[ "$status" == "404" ]]; then
  node --input-type=module - "$VERCEL_PROJECT_NAME" > "$workdir/create-project.json" <<'NODE'
const [name] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({ name })}\n`);
NODE

  create_status="$(curl --silent --show-error \
    --output "$workdir/project.json" \
    --write-out '%{http_code}' \
    --request POST \
    --url "${api}/v11/projects?teamId=${VERCEL_ORG_ID}" \
    --header "$auth" \
    --header 'Content-Type: application/json' \
    --data-binary @"$workdir/create-project.json")"

  if [[ "$create_status" != "200" && "$create_status" != "201" ]]; then
    echo "::error::Unable to create Vercel project ${VERCEL_PROJECT_NAME} in configured team (HTTP ${create_status})" >&2
    exit 1
  fi
  scope_mode="explicit"
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

if [[ "$scope_mode" == "inferred" ]]; then
  patch_url="${api}/v9/projects/${project_id}"
else
  patch_url="${api}/v9/projects/${project_id}?teamId=${VERCEL_ORG_ID}"
fi

patch_status="$(curl --silent --show-error \
  --output "$workdir/project-updated.json" \
  --write-out '%{http_code}' \
  --request PATCH \
  --url "$patch_url" \
  --header "$auth" \
  --header 'Content-Type: application/json' \
  --data-binary @"$workdir/project-policy.json")"

if [[ "$patch_status" != "200" ]]; then
  echo "::error::Unable to converge Vercel project policy for ${VERCEL_PROJECT_NAME} (HTTP ${patch_status}, auth_context=${scope_mode})" >&2
  exit 1
fi

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
printf 'auth_context=%s\n' "$scope_mode"
