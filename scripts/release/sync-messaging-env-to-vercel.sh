#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"
: "${MESSAGING_RABBITMQ_URL:?MESSAGING_RABBITMQ_URL is required}"

case "${VERCEL_PROJECT_NAME:-}" in
  moventra-tms-staging) runtime_environment=staging ;;
  moventra-tms) runtime_environment=production ;;
  *)
    echo "::error::Unsupported Vercel project for governed messaging synchronization: ${VERCEL_PROJECT_NAME:-unset}" >&2
    exit 1
    ;;
esac

sync_env() {
  local key="$1"
  local value="$2"
  local comment="$3"
  VERCEL_ENV_KEY="$key" \
  VERCEL_ENV_VALUE="$value" \
  VERCEL_ENV_TARGET=production \
  VERCEL_ENV_COMMENT="$comment" \
    bash "$ROOT/scripts/release/vercel-upsert-sensitive-env.sh" >/dev/null
}

# Resolve the exact runtime contract before any Vercel mutation. The URL itself is
# deliberately never printed; staging/production must use TLS.
MOVENTRA_ENV="$runtime_environment" \
MESSAGING_PROVIDER=rabbitmq \
MESSAGING_RABBITMQ_URL="$MESSAGING_RABBITMQ_URL" \
node --input-type=module <<'NODE'
import { resolveMessagingConfig } from './src/infrastructure/messaging/rabbitmq/rabbitmq-config.js';
const config = resolveMessagingConfig(process.env);
if (config.provider !== 'rabbitmq') process.exit(1);
NODE

sync_env MESSAGING_PROVIDER rabbitmq 'Moventra messaging provider managed by protected release automation'
sync_env MESSAGING_RABBITMQ_URL "$MESSAGING_RABBITMQ_URL" 'Moventra RabbitMQ credential managed by protected release automation'
sync_env MOVENTRA_ENV "$runtime_environment" 'Moventra runtime environment managed by protected release automation'

printf 'messaging_provider=rabbitmq\n'
printf 'runtime_environment=%s\n' "$runtime_environment"
printf 'messaging_url_synced=true\n'
printf 'result=success\n'
