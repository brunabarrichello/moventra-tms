#!/usr/bin/env bash
set -euo pipefail

environment="${1:-}"
case "$environment" in
  staging|production) ;;
  *) echo 'usage: sync-auth-env-to-vercel.sh <staging|production>' >&2; exit 64 ;;
esac

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"

auth_json="$(node scripts/release/resolve-auth-provider.mjs "$environment")"

upsert() {
  local key="$1"
  local value="$2"
  test -n "$value" || { echo "::error::${key} resolved empty" >&2; exit 1; }
  VERCEL_ENV_KEY="$key" \
  VERCEL_ENV_VALUE="$value" \
  VERCEL_ENV_TARGET=production \
  VERCEL_ENV_COMMENT="Moventra governed JWT trust contract (${environment})" \
    bash scripts/release/vercel-upsert-sensitive-env.sh >/dev/null
}

provider_key="$(jq -r '.providerKey' <<< "$auth_json")"
issuer="$(jq -r '.issuer' <<< "$auth_json")"
audience="$(jq -r '.audience' <<< "$auth_json")"
algorithm="$(jq -r '.algorithm' <<< "$auth_json")"
jwks_url="$(jq -r '.jwksUrl' <<< "$auth_json")"
public_key_pem="$(jq -r '.publicKeyPem' <<< "$auth_json")"
kid="$(jq -r '.kid' <<< "$auth_json")"
public_key_sha256="$(jq -r '.publicKeySha256' <<< "$auth_json")"

upsert MOVENTRA_AUTH_PROVIDER_KEY "$provider_key"
upsert MOVENTRA_AUTH_JWT_ISSUER "$issuer"
upsert MOVENTRA_AUTH_JWT_AUDIENCE "$audience"
upsert MOVENTRA_AUTH_JWT_ALGORITHM "$algorithm"
upsert MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM "$public_key_pem"
upsert MOVENTRA_AUTH_JWT_JWKS_URL "$jwks_url"

cat <<EOF
provider_key=${provider_key}
issuer=${issuer}
audience=${audience}
algorithm=${algorithm}
jwks_url=${jwks_url}
kid=${kid}
public_key_sha256=${public_key_sha256}
public_key_pem_synced=true
EOF
