#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 <artifact-directory>" >&2
  exit 64
fi

artifact_dir="$1"
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
  exit 66
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
tar -xzf "$tarball" -C "$workdir"

manifest="$workdir/build-manifest.json"
function_dir="$workdir/.vercel/output/functions/api/health.func"

metadata="$(node --input-type=module - "$manifest" "$workdir" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [manifestPath, root] = process.argv.slice(2);
if (!fs.existsSync(manifestPath)) throw new Error('build-manifest.json is missing');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schema_version !== 1) throw new Error('unexpected manifest schema');
if (manifest.product !== 'Moventra TMS') throw new Error('unexpected product');
if (manifest.service !== 'moventra-api') throw new Error('unexpected service');
if (!/^[0-9a-f]{40}$/.test(manifest.commit_sha)) throw new Error('invalid commit SHA');
if (manifest.artifact !== `moventra-tms-${manifest.commit_sha}.tar.gz`) throw new Error('artifact name does not match commit SHA');
if (manifest.artifact_format !== 'vercel-build-output-v3') throw new Error('unexpected artifact format');
if (manifest.build_output_api_version !== 3) throw new Error('unexpected Build Output API version');
if (manifest.runtime !== 'nodejs22.x') throw new Error('unexpected runtime');

const outputConfigPath = path.join(root, '.vercel', 'output', 'config.json');
const functionConfigPath = path.join(root, '.vercel', 'output', 'functions', 'api', 'health.func', '.vc-config.json');
const handlerPath = path.join(root, '.vercel', 'output', 'functions', 'api', 'health.func', 'index.js');
for (const required of [outputConfigPath, functionConfigPath, handlerPath]) {
  if (!fs.existsSync(required)) throw new Error(`missing prebuilt file: ${required}`);
}
const outputConfig = JSON.parse(fs.readFileSync(outputConfigPath, 'utf8'));
if (outputConfig.version !== 3) throw new Error('invalid output config version');
const functionConfig = JSON.parse(fs.readFileSync(functionConfigPath, 'utf8'));
if (functionConfig.runtime !== 'nodejs22.x' || functionConfig.handler !== 'index.js') {
  throw new Error('invalid function runtime contract');
}
const handler = fs.readFileSync(handlerPath, 'utf8');
if (!handler.includes(manifest.commit_sha)) throw new Error('handler does not embed manifest commit SHA');
process.stdout.write(`commit_sha=${manifest.commit_sha}\ngithub_artifact_name=moventra-tms-${manifest.commit_sha}\nartifact_name=${manifest.artifact}\nartifact_format=${manifest.artifact_format}\n`);
NODE
)"

commit_sha="$(printf '%s\n' "$metadata" | awk -F= '$1=="commit_sha" {print $2}')"
node --input-type=module - "$function_dir/index.js" "$commit_sha" <<'NODE'
import { pathToFileURL } from 'node:url';

const [handlerPath, expectedSha] = process.argv.slice(2);
const module = await import(pathToFileURL(handlerPath));
let statusCode = 0;
let body;
const headers = new Map();
const response = {
  setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
  status(code) { statusCode = code; return this; },
  json(payload) { body = payload; return this; },
};
await module.default({}, response);
if (statusCode !== 200) throw new Error('prebuilt health handler did not return HTTP 200');
if (body?.status !== 'ok' || body?.product !== 'Moventra TMS' || body?.service !== 'moventra-api') {
  throw new Error('prebuilt health identity is invalid');
}
if (body?.version !== expectedSha) throw new Error('prebuilt health version does not match manifest commit SHA');
if (headers.get('cache-control') !== 'no-store') throw new Error('prebuilt health cache policy is invalid');
NODE

printf '%s\n' "$metadata"
printf 'artifact_sha256=%s\n' "$actual_sha"
