import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('phase 022 materializes tenant-scoped idempotency without anticipating Outbox 023', () => {
  for (const path of [
    'db/migrations/0014_idempotency.sql',
    'db/validation/0014_idempotency_validation.sql',
    'db/runtime/idempotency-runtime-access-validation.sql',
    'src/modules/idempotency/fingerprint.js',
    'src/modules/idempotency/idempotency-repository.js',
    'src/modules/idempotency/idempotency-service.js',
    'docs/implementation/022-idempotencia.md',
  ]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} must exist`);
  }

  assert.equal(existsSync(new URL('../../db/migrations/0015_outbox.sql', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../src/modules/outbox/', import.meta.url)), false);

  const doc = read('docs/implementation/022-idempotencia.md');
  assert.match(doc, /022 — Idempotência = ACTIVE \/ DEFINED/i);
  assert.match(doc, /023 — Transactional Outbox.*NOT ACTIVE/is);
  assert.match(doc, /não promete exactly-once para efeitos externos/i);
});

test('idempotency persistence has tenant uniqueness, RLS, expiry and no plaintext client key column', () => {
  const migration = read('db/migrations/0014_idempotency.sql');
  assert.match(migration, /CREATE TABLE idempotency\.records/);
  assert.match(migration, /UNIQUE \(tenant_id, operation_key, key_hash\)/);
  assert.match(migration, /ALTER TABLE idempotency\.records ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_isolation_idempotency_records/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(migration, /key_hash CHAR\(64\)/);
  assert.match(migration, /fingerprint_version SMALLINT/);
  assert.doesNotMatch(migration, /\bidempotency_key\s+(TEXT|VARCHAR|CHAR)/i);
});

test('runtime least privilege grants idempotency mutation without DELETE or schema CREATE', () => {
  const access = read('db/runtime/runtime-access.sql');
  const validation = read('db/runtime/idempotency-runtime-access-validation.sql');

  assert.match(access, /GRANT USAGE ON SCHEMA[\s\S]*idempotency/);
  assert.match(access, /GRANT SELECT, INSERT, UPDATE ON[\s\S]*idempotency\.records/);
  assert.match(access, /REVOKE DELETE ON[\s\S]*idempotency\.records/);
  assert.match(access, /REVOKE CREATE ON SCHEMA[\s\S]*idempotency/);
  assert.match(validation, /cross-tenant idempotency read was not isolated/);
  assert.match(validation, /runtime idempotency DELETE unexpectedly succeeded/);
});

test('fingerprints are versioned SHA-256 values and strip transport-only metadata', () => {
  const fingerprint = read('src/modules/idempotency/fingerprint.js');
  assert.match(fingerprint, /createHash\('sha256'\)/);
  assert.match(fingerprint, /IDEMPOTENCY_FINGERPRINT_VERSION = 1/);
  assert.match(fingerprint, /IDEMPOTENCY_KEY_HASH_VERSION = 1/);
  assert.match(fingerprint, /TRANSPORT_ONLY_KEYS/);
  for (const forbiddenTransportField of ['authorization', 'cookie', 'requestid', 'correlationid', 'traceid']) {
    assert.match(fingerprint, new RegExp(`'${forbiddenTransportField}'`));
  }
});

test('authorized tenant pipeline shares its transaction with idempotency and skips duplicate SUCCESS audit on replay', () => {
  const authorized = read('src/modules/security/authorized-tenant-operation.js');
  assert.match(authorized, /createIdempotencyService/);
  assert.match(authorized, /new PostgresIdempotencyRepository\(\{ query \}\)/);
  assert.match(authorized, /execute: \(\) => operation\(operationContext\)/);
  assert.match(authorized, /if \(!idempotentResult\.replayed\)/);
  assert.match(authorized, /components\.audit\.append/);
});

test('idempotency telemetry uses only controlled operation/outcome dimensions', () => {
  const metrics = read('src/infrastructure/observability/metrics.js');
  const service = read('src/modules/idempotency/idempotency-service.js');

  assert.match(metrics, /idempotency_requests_total/);
  assert.match(metrics, /idempotency_duration_ms/);
  assert.match(metrics, /normalizeIdempotencyOperationKey/);
  assert.doesNotMatch(metrics, /keyHash|key_hash|fingerprint|idempotencyKey|tenantId|userId/);

  assert.match(service, /event: 'idempotency\.operation\.completed'/);
  assert.match(service, /operationKey,\n\s+outcome,\n\s+durationMs/);
});
