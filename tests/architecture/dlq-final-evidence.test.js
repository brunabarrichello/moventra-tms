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
] = await Promise.all([
  read('.github/workflows/release-gate.yml'),
  read('.github/workflows/production-promotion.yml'),
  read('.github/workflows/dlq-contract.yml'),
  read('scripts/ci/runtime-access-contract.sh'),
  read('scripts/release/sync-messaging-env-to-vercel.sh'),
  read('scripts/release/smoke-messaging.mjs'),
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

test('Neon Auth staging handshake uses one deterministic service JWT source and the canonical subject contract', () => {
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
  assert.match(adminSmoke, /source: 'token-endpoint'/);
  assert.match(adminSmoke, /subjectClaims: authConfig\.subjectClaims/);
  assert.doesNotMatch(adminSmoke, /return signupJwt|return sessionJwt/);
  assert.match(adminSmoke, /sanitizeDiagnostic/);
  assert.match(adminSmoke, /replaceAll\(password, '\[redacted\]'\)/);
});

test('release gate rejects JWT contract drift before recording staging evidence', () => {
  assert.match(releaseGate, /MOVENTRA_AUTH_CLIENT_ORIGIN: \$\{\{ env\.STAGING_URL \}\}/);
  assert.match(releaseGate, /\.authJwtSource[^\n]+token-endpoint/);
  assert.match(releaseGate, /\.authIssuerMatch[^\n]+true/);
  assert.match(releaseGate, /\.authAudienceMatch[^\n]+true/);
  assert.match(releaseGate, /\.authAlgorithmMatch[^\n]+true/);
  assert.match(releaseGate, /auth_jwt_source=\$\{AUTH_JWT_SOURCE\}/);
  assert.match(releaseGate, /auth_issuer_match=\$\{AUTH_ISSUER_MATCH\}/);
  assert.match(releaseGate, /auth_audience_match=\$\{AUTH_AUDIENCE_MATCH\}/);
  assert.match(releaseGate, /auth_algorithm_match=\$\{AUTH_ALGORITHM_MATCH\}/);
  assert.match(releaseGate, /auth_subject_claim=\$\{AUTH_SUBJECT_CLAIM\}/);
});

test('JWT diagnostics remain non-authoritative and expose only contract comparisons or hashes', () => {
  assert.match(adminSmoke, /inspectUntrustedJwtContract/);
  assert.match(adminSmoke, /issuerMatches/);
  assert.match(adminSmoke, /audienceMatches/);
  assert.match(adminSmoke, /algorithmMatches/);
  assert.match(adminSmoke, /issuerSha256/);
  assert.match(adminSmoke, /audienceSha256/);
  assert.match(adminSmoke, /kidSha256/);
  assert.doesNotMatch(adminSmoke, /console\.log\([^\n]*jwt|process\.stdout\.write\([^\n]*token/i);
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
