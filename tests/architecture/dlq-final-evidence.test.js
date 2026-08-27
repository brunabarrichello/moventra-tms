import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [releaseGate, dlqContract, runtimeContract, messagingSync, smoke] = await Promise.all([
  read('.github/workflows/release-gate.yml'),
  read('.github/workflows/dlq-contract.yml'),
  read('scripts/ci/runtime-access-contract.sh'),
  read('scripts/release/sync-messaging-env-to-vercel.sh'),
  read('scripts/release/smoke-dlq-admin.mjs'),
]);

test('final 026 contract executes real PostgreSQL DLQ concurrency', () => {
  assert.match(runtimeContract, /validate-dlq-concurrency\.mjs/);
  assert.match(dlqContract, /postgresql_runtime_and_concurrency=\$\{CONCURRENCY_OUTCOME\}/);
  assert.match(dlqContract, /0020_dlq_job_reprocessing_lineage_validation\.sql/);
  assert.match(dlqContract, /contract=final-evidence-closure/);
});

test('staging release synchronizes RabbitMQ before immutable deployment', () => {
  const syncIndex = releaseGate.indexOf('Synchronize staging RabbitMQ runtime contract to Vercel');
  const deployIndex = releaseGate.indexOf('Deploy exact prebuilt artifact to staging');
  assert.ok(syncIndex >= 0);
  assert.ok(deployIndex > syncIndex);
  assert.match(messagingSync, /MESSAGING_PROVIDER rabbitmq/);
  assert.match(messagingSync, /MESSAGING_RABBITMQ_URL/);
  assert.match(messagingSync, /runtime_environment=staging|moventra-tms-staging/);
});

test('staging release proves authenticated Admin API and Vercel messaging runtime', () => {
  assert.match(releaseGate, /Verify authenticated DLQ Admin and Vercel RabbitMQ runtime/);
  assert.match(releaseGate, /dlq_admin_auth_e2e=success/);
  assert.match(releaseGate, /vercel_runtime_messaging=success/);
  assert.match(releaseGate, /dlq_http_idempotency=success/);
  assert.match(smoke, /BearerJwtAssertionVerifier/);
  assert.match(smoke, /dlq\.read/);
  assert.match(smoke, /dlq\.reprocess/);
  assert.match(smoke, /x-idempotency-outcome/);
  assert.match(smoke, /publisher confirm|RabbitMQ publisher confirm/i);
});

test('smoke never imports signing material and stores only a subject hash in evidence', () => {
  assert.doesNotMatch(smoke, /private[_-]?key/i);
  assert.match(smoke, /authSubjectSha256/);
  assert.match(releaseGate, /auth_smoke_subject_sha256=/);
});

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}
