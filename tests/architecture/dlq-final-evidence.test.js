import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  releaseGate,
  productionPromotion,
  dlqContract,
  runtimeContract,
  messagingSync,
  messagingSmoke,
  adminSmoke,
  authConfig,
  authResolver,
] = await Promise.all([
  read('.github/workflows/release-gate.yml'),
  read('.github/workflows/production-promotion.yml'),
  read('.github/workflows/dlq-contract.yml'),
  read('scripts/ci/runtime-access-contract.sh'),
  read('scripts/release/sync-messaging-env-to-vercel.sh'),
  read('scripts/release/smoke-messaging.mjs'),
  read('scripts/release/smoke-dlq-admin.mjs'),
  read('config/auth/neon-auth.json'),
  read('scripts/release/resolve-auth-provider.mjs'),
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

test('production messaging readiness converges the same validated RabbitMQ contract before deploy', () => {
  const readinessIndex = productionPromotion.indexOf('Verify production messaging readiness');
  const deployIndex = productionPromotion.indexOf('Deploy exact approved prebuilt artifact to production');
  assert.ok(readinessIndex >= 0);
  assert.ok(deployIndex > readinessIndex);
  assert.match(productionPromotion, /MESSAGING_RABBITMQ_URL: \$\{\{ secrets\.MESSAGING_RABBITMQ_URL \}\}/);
  assert.match(productionPromotion, /node scripts\/release\/smoke-messaging\.mjs/);
  assert.match(messagingSmoke, /sync-messaging-env-to-vercel\.sh/);
  assert.match(messagingSmoke, /hasGovernedVercelContext/);
});

test('staging release proves authenticated Admin API and Vercel messaging runtime', () => {
  assert.match(releaseGate, /Verify authenticated DLQ Admin and Vercel RabbitMQ runtime/);
  assert.match(releaseGate, /dlq_admin_auth_e2e=success/);
  assert.match(releaseGate, /vercel_runtime_messaging=success/);
  assert.match(releaseGate, /dlq_http_idempotency=success/);
  assert.match(adminSmoke, /BearerJwtAssertionVerifier/);
  assert.match(adminSmoke, /dlq\.read/);
  assert.match(adminSmoke, /dlq\.reprocess/);
  assert.match(adminSmoke, /x-idempotency-outcome/);
  assert.match(adminSmoke, /publisher confirm|RabbitMQ publisher confirm/i);
});

test('Neon Auth staging handshake preserves managed client protocol, explicit origin and sanitized diagnostics', () => {
  assert.match(adminSmoke, /X-Neon-Client-Info/);
  assert.match(adminSmoke, /moventra-tms-release-smoke/);
  assert.match(adminSmoke, /MOVENTRA_AUTH_CLIENT_ORIGIN/);
  assert.match(adminSmoke, /STAGING_URL/);
  assert.match(adminSmoke, /headers\.set\('Origin', authClientOrigin\)/);
  assert.match(adminSmoke, /callbackURL: authClientOrigin/);
  assert.match(adminSmoke, /requiredOrigin/);
  assert.match(adminSmoke, /set-auth-jwt/);
  assert.match(adminSmoke, /\/get-session/);
  assert.match(adminSmoke, /\/token/);
  assert.match(adminSmoke, /sanitizeDiagnostic/);
  assert.match(adminSmoke, /replaceAll\(password, '\[redacted\]'\)/);
});

test('managed Auth API base URL is distinct from JWT issuer while remaining same-origin and JWKS anchored', () => {
  assert.match(authConfig, /"baseUrl": "https:\/\/[^"]+\/neondb\/auth"/);
  assert.match(authConfig, /"issuer": "https:\/\/[^"]+\.neon\.tech"/);
  assert.match(authResolver, /baseUrl\.origin !== issuerUrl\.origin/);
  assert.match(authResolver, /JWKS URL must be anchored to the managed Auth base URL/);
  assert.match(adminSmoke, /fetch\(`\$\{auth\.baseUrl\}\$\{path\}`/);
  assert.match(adminSmoke, /subjectClaims: authConfig\.subjectClaims/);
});

test('smoke never imports signing material and stores only hashes for identity/origin evidence', () => {
  assert.doesNotMatch(adminSmoke, /private[_-]?key/i);
  assert.match(adminSmoke, /authSubjectSha256/);
  assert.match(adminSmoke, /authClientOriginSha256/);
  assert.match(releaseGate, /auth_smoke_subject_sha256=/);
});

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}
