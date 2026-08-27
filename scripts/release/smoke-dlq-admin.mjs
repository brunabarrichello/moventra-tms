import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { BearerJwtAssertionVerifier } from '../../src/http/bearer-jwt-assertion.js';

const { Client } = pg;
const deploymentUrl = requiredUrl(process.env.DEPLOYMENT_URL, 'DEPLOYMENT_URL');
const migrationsDatabaseUrl = requiredText(process.env.MIGRATIONS_DATABASE_URL, 'MIGRATIONS_DATABASE_URL');
const authClientOrigin = requiredOrigin(
  process.env.MOVENTRA_AUTH_CLIENT_ORIGIN || process.env.STAGING_URL,
  'MOVENTRA_AUTH_CLIENT_ORIGIN/STAGING_URL',
);
const environment = process.env.MOVENTRA_AUTH_ENVIRONMENT || 'staging';
if (environment !== 'staging') {
  throw new Error('DLQ Admin release smoke is restricted to staging');
}

const authConfig = JSON.parse(await readFile(new URL('../../config/auth/neon-auth.json', import.meta.url), 'utf8'));
const auth = authConfig[environment];
if (!auth?.issuer || !auth?.audience || !auth?.jwksUrl) {
  throw new Error('Staging Neon Auth trust contract is incomplete');
}

const runIdentity = safeRunIdentity(process.env.GITHUB_RUN_ID || randomUUID());
const email = `moventra-dlq-smoke-${runIdentity}@example.com`;
const password = `Mv1!${randomBytes(24).toString('base64url')}`;
const authClientInfo = JSON.stringify({
  sdk: 'moventra-tms-release-smoke',
  version: '026',
  runtime: 'node',
  runtimeVersion: process.versions.node,
  platform: process.platform,
  arch: process.arch,
});
const db = new Client({ connectionString: migrationsDatabaseUrl });
let cookies = '';
let externalSubject = null;
let fixture = null;
let authUserCleanup = 'not-attempted';

await db.connect();
try {
  const jwt = await createEphemeralJwt();
  const verifier = new BearerJwtAssertionVerifier({
    providerKey: authConfig.providerKey,
    issuer: auth.issuer,
    audience: auth.audience,
    jwksUrl: auth.jwksUrl,
    algorithm: authConfig.algorithm,
  });
  const verified = await verifier.verifyToken(jwt);
  externalSubject = verified.subject;
  assert.ok(externalSubject);

  fixture = await prepareMoventraFixture({ subject: externalSubject });
  const correlationBase = `dlq-smoke-${runIdentity}`.slice(0, 96);
  const commonHeaders = {
    authorization: `Bearer ${jwt}`,
    'x-moventra-tenant-id': fixture.tenantId,
  };

  const list = await apiJson(`${deploymentUrl}/api/v1/dlq/entries?status=quarantined&source_kind=message&limit=20`, {
    headers: { ...commonHeaders, 'x-correlation-id': `${correlationBase}-list` },
  });
  assert.equal(list.response.status, 200, `DLQ list failed with HTTP ${list.response.status}`);
  assert.ok(Array.isArray(list.body?.items));
  assert.ok(list.body.items.some((entry) => entry.id === fixture.dlqEntryId), 'staging list must expose the tenant fixture');

  const detail = await apiJson(`${deploymentUrl}/api/v1/dlq/entries/${fixture.dlqEntryId}`, {
    headers: { ...commonHeaders, 'x-correlation-id': `${correlationBase}-detail` },
  });
  assert.equal(detail.response.status, 200, `DLQ detail failed with HTTP ${detail.response.status}`);
  assert.equal(detail.body?.id, fixture.dlqEntryId);
  const etag = detail.response.headers.get('etag');
  assert.equal(etag, '"v1"', 'fresh DLQ fixture must expose strong version ETag v1');

  const idempotencyKey = `staging-dlq-smoke-${runIdentity}-${randomUUID()}`;
  const mutationCorrelation = `${correlationBase}-reprocess`;
  const first = await apiJson(`${deploymentUrl}/api/v1/dlq/entries/${fixture.dlqEntryId}/reprocess`, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      'x-correlation-id': mutationCorrelation,
      'if-match': etag,
      'idempotency-key': idempotencyKey,
    },
  });
  assert.equal(first.response.status, 200, `DLQ reprocess failed with HTTP ${first.response.status}`);
  assert.equal(first.response.headers.get('x-idempotency-outcome'), 'executed');
  assert.equal(first.body?.entry?.status, 'resolved');
  assert.equal(first.body?.entry?.resolutionCode, 'message_reprocessed');
  assert.equal(first.body?.result?.kind, 'message');
  assert.equal(first.body?.result?.messageId, fixture.outboxEventId);
  assert.equal(first.body?.result?.confirmed, true, 'Vercel runtime must receive RabbitMQ publisher confirm');

  const auditAfterFirst = await countMutationAudit(mutationCorrelation);
  assert.ok(auditAfterFirst >= 2, 'first governed mutation must produce administrative and business audit evidence');

  const replay = await apiJson(`${deploymentUrl}/api/v1/dlq/entries/${fixture.dlqEntryId}/reprocess`, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      'x-correlation-id': mutationCorrelation,
      'if-match': etag,
      'idempotency-key': idempotencyKey,
    },
  });
  assert.equal(replay.response.status, 200, `DLQ idempotent replay failed with HTTP ${replay.response.status}`);
  assert.equal(replay.response.headers.get('x-idempotency-outcome'), 'replayed');
  assert.deepEqual(replay.body, first.body, 'idempotent retry must replay the exact stored response');

  const auditAfterReplay = await countMutationAudit(mutationCorrelation);
  assert.equal(auditAfterReplay, auditAfterFirst, 'idempotent retry must not duplicate SUCCESS audit');

  const persisted = await db.query(
    `SELECT status, resolution_code, reprocess_count, version
       FROM dlq.entries
      WHERE tenant_id = $1 AND id = $2`,
    [fixture.tenantId, fixture.dlqEntryId],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].status, 'resolved');
  assert.equal(persisted.rows[0].resolution_code, 'message_reprocessed');
  assert.equal(Number(persisted.rows[0].reprocess_count), 1, 'idempotent HTTP retry must not acquire a second replay claim');

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    environment,
    authProvider: authConfig.providerKey,
    authAlgorithm: authConfig.algorithm,
    authSubjectSha256: sha256(externalSubject),
    authClientOriginSha256: sha256(authClientOrigin),
    authenticatedList: 'success',
    tenantRbacRlsDetail: 'success',
    governedMessageReprocess: 'success',
    vercelRuntimeRabbitMqConfirm: 'success',
    idempotentReplay: 'success',
    duplicateSuccessAudit: false,
    auditEventsForMutation: auditAfterFirst,
  })}\n`);
} finally {
  if (fixture) {
    await cleanupMoventraFixture(fixture).catch((error) => {
      process.stderr.write(`DLQ smoke fixture cleanup failed: ${safeError(error)}\n`);
    });
  } else if (externalSubject) {
    await cleanupExternalIdentity(externalSubject).catch(() => {});
  }
  if (cookies) {
    authUserCleanup = await cleanupAuthUser().catch(() => 'unsupported-or-failed');
  }
  await db.end().catch(() => {});
  process.stderr.write(`DLQ smoke auth user cleanup=${authUserCleanup}\n`);
}

async function createEphemeralJwt() {
  const signup = await authFetch('/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      name: 'Moventra DLQ Staging Smoke',
      email,
      password,
      callbackURL: authClientOrigin,
    }),
  });
  if (!signup.ok) {
    throw await authHttpError('signup', signup);
  }

  cookies = responseCookies(signup.headers);
  if (!cookies) {
    throw new Error('Neon Auth staging signup did not establish a session cookie');
  }

  const signupJwt = responseJwt(signup.headers);
  if (signupJwt) {
    return signupJwt;
  }

  const sessionResponse = await authFetch('/get-session', {
    headers: { cookie: cookies, accept: 'application/json' },
  });
  if (!sessionResponse.ok) {
    throw await authHttpError('session', sessionResponse);
  }
  const sessionJwt = responseJwt(sessionResponse.headers);
  if (sessionJwt) {
    return sessionJwt;
  }

  const tokenResponse = await authFetch('/token', {
    headers: { cookie: cookies, accept: 'application/json' },
  });
  if (!tokenResponse.ok) {
    throw await authHttpError('jwt', tokenResponse);
  }
  const body = await tokenResponse.json();
  if (!isJwt(body?.token)) {
    throw new Error('Neon Auth staging JWT endpoint returned an invalid token contract');
  }
  return body.token;
}

async function authFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Origin', authClientOrigin);
  headers.set('X-Neon-Client-Info', authClientInfo);
  return fetch(`${auth.issuer}${path}`, {
    ...options,
    headers,
    redirect: 'manual',
  });
}

async function authHttpError(operation, response) {
  const details = await sanitizedAuthError(response);
  const suffix = [details.code && `code=${details.code}`, details.message && `message=${details.message}`]
    .filter(Boolean)
    .join(' ');
  return new Error(`Neon Auth staging ${operation} failed with HTTP ${response.status}${suffix ? ` ${suffix}` : ''}`);
}

async function sanitizedAuthError(response) {
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }
  return {
    code: sanitizeDiagnostic(body?.code, 80),
    message: sanitizeDiagnostic(body?.message, 180),
  };
}

function sanitizeDiagnostic(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replaceAll(email, '[smoke-email]')
    .replaceAll(password, '[redacted]')
    .replaceAll(/[\r\n\t]+/g, ' ')
    .slice(0, maxLength);
}

function responseJwt(headers) {
  const value = headers.get('set-auth-jwt');
  return isJwt(value) ? value : null;
}

function isJwt(value) {
  return typeof value === 'string' && value.split('.').length === 3;
}

async function prepareMoventraFixture({ subject }) {
  await db.query('BEGIN');
  try {
    const tenant = await db.query(
      `INSERT INTO organization.tenants (
         code, display_name, status, default_timezone, default_currency
       ) VALUES ('staging-dlq-smoke', 'Staging DLQ Smoke', 'ACTIVE', 'UTC', 'USD')
       ON CONFLICT (code) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = 'ACTIVE',
         default_timezone = EXCLUDED.default_timezone,
         default_currency = EXCLUDED.default_currency,
         updated_at = clock_timestamp(),
         version = organization.tenants.version + 1
       RETURNING id`,
    );
    const tenantId = tenant.rows[0].id;

    const user = await db.query(
      `INSERT INTO identity.users (
         primary_email, display_name, status
       ) VALUES ('moventra-dlq-staging-smoke@example.com', 'Moventra DLQ Staging Smoke', 'ACTIVE')
       ON CONFLICT (primary_email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = 'ACTIVE',
         updated_at = clock_timestamp(),
         version = identity.users.version + 1
       RETURNING id`,
    );
    const userId = user.rows[0].id;

    const membership = await db.query(
      `INSERT INTO identity.memberships (tenant_id, user_id, status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         status = 'ACTIVE',
         updated_at = clock_timestamp(),
         version = identity.memberships.version + 1
       RETURNING id`,
      [tenantId, userId],
    );
    const membershipId = membership.rows[0].id;

    const role = await db.query(
      `INSERT INTO security.roles (tenant_id, code, name, description, status)
       VALUES ($1, 'dlq-smoke-operator', 'DLQ Smoke Operator', 'Staging-only release evidence role', 'ACTIVE')
       ON CONFLICT (tenant_id, code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         status = 'ACTIVE',
         updated_at = clock_timestamp(),
         version = security.roles.version + 1
       RETURNING id`,
      [tenantId],
    );
    const roleId = role.rows[0].id;

    const permissions = await db.query(
      `SELECT id, code FROM security.permissions
        WHERE code = ANY($1::text[])
          AND status = 'ACTIVE'`,
      [['dlq.read', 'dlq.reprocess']],
    );
    assert.equal(permissions.rowCount, 2, 'staging permission catalog must contain DLQ read/reprocess');
    for (const permission of permissions.rows) {
      await db.query(
        `INSERT INTO security.role_permissions (tenant_id, role_id, permission_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenantId, roleId, permission.id],
      );
    }

    await db.query(
      `INSERT INTO security.membership_roles (tenant_id, membership_id, role_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [tenantId, membershipId, roleId],
    );
    await db.query(
      `UPDATE security.membership_roles
          SET status = 'ACTIVE', updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = $1 AND membership_id = $2 AND role_id = $3`,
      [tenantId, membershipId, roleId],
    );
    const assignment = await db.query(
      `SELECT id FROM security.membership_roles
        WHERE tenant_id = $1 AND membership_id = $2 AND role_id = $3 AND status = 'ACTIVE'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, membershipId, roleId],
    );
    assert.equal(assignment.rowCount, 1);

    await db.query(
      `INSERT INTO security.organizational_scopes (tenant_id, scope_level, status)
       VALUES ($1, 'TENANT', 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [tenantId],
    );
    const scope = await db.query(
      `SELECT id FROM security.organizational_scopes
        WHERE tenant_id = $1 AND scope_level = 'TENANT' AND status = 'ACTIVE'
        LIMIT 1`,
      [tenantId],
    );
    assert.equal(scope.rowCount, 1);
    await db.query(
      `INSERT INTO security.role_assignment_scopes (tenant_id, assignment_id, scope_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tenantId, assignment.rows[0].id, scope.rows[0].id],
    );

    await db.query(
      `DELETE FROM identity.external_identities
        WHERE user_id = $1 AND provider_key = $2 AND issuer = $3`,
      [userId, authConfig.providerKey, auth.issuer],
    );
    await db.query(
      `INSERT INTO identity.external_identities (
         user_id, provider_key, issuer, subject, status
       ) VALUES ($1, $2, $3, $4, 'ACTIVE')`,
      [userId, authConfig.providerKey, auth.issuer, subject],
    );

    await db.query('DELETE FROM idempotency.records WHERE tenant_id = $1', [tenantId]);
    await db.query('DELETE FROM dlq.entries WHERE tenant_id = $1', [tenantId]);
    await db.query('DELETE FROM outbox.events WHERE tenant_id = $1', [tenantId]);

    const outbox = await db.query(
      `INSERT INTO outbox.events (
         tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
         payload, metadata, occurred_at, available_at, published_at
       ) VALUES (
         $1, 'validation', NULL, 'validation.dlq_smoke', 1,
         '{"probe":"staging-dlq-runtime"}'::jsonb,
         '{}'::jsonb,
         clock_timestamp(), clock_timestamp(), clock_timestamp()
       ) RETURNING id`,
      [tenantId],
    );
    const outboxEventId = outbox.rows[0].id;

    const dlq = await db.query(
      `INSERT INTO dlq.entries (
         tenant_id, source_kind, source_id, source_type, source_schema_version,
         failure_code, failure_class, snapshot, metadata, max_reprocess_attempts
       ) VALUES (
         $1, 'message', $2, 'validation.dlq_smoke', 1,
         'MVT_VALIDATION_FAILED', 'terminal',
         jsonb_build_object(
           'eventId', $2,
           'messageId', $2,
           'tenantId', $1,
           'eventType', 'validation.dlq_smoke',
           'schemaVersion', 1
         ),
         '{"origin":"staging_release_smoke"}'::jsonb,
         3
       ) RETURNING id, version`,
      [tenantId, outboxEventId],
    );
    assert.equal(Number(dlq.rows[0].version), 1);
    await db.query('COMMIT');
    return { tenantId, userId, membershipId, outboxEventId, dlqEntryId: dlq.rows[0].id };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function cleanupMoventraFixture({ tenantId, userId }) {
  await db.query('BEGIN');
  try {
    await db.query(
      `DELETE FROM identity.external_identities
        WHERE user_id = $1 AND provider_key = $2 AND issuer = $3`,
      [userId, authConfig.providerKey, auth.issuer],
    );
    await db.query('DELETE FROM idempotency.records WHERE tenant_id = $1', [tenantId]);
    await db.query('DELETE FROM dlq.entries WHERE tenant_id = $1', [tenantId]);
    await db.query('DELETE FROM outbox.events WHERE tenant_id = $1', [tenantId]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function cleanupExternalIdentity(subject) {
  await db.query(
    `DELETE FROM identity.external_identities
      WHERE provider_key = $1 AND issuer = $2 AND subject = $3`,
    [authConfig.providerKey, auth.issuer, subject],
  );
}

async function cleanupAuthUser() {
  const response = await authFetch('/delete-user', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies, accept: 'application/json' },
    body: JSON.stringify({ password }),
  });
  return response.ok ? 'success' : `unsupported-http-${response.status}`;
}

async function countMutationAudit(correlationId) {
  const result = await db.query(
    `SELECT count(*)::integer AS count
       FROM audit.audit_events
      WHERE tenant_id = $1
        AND correlation_id = $2
        AND outcome = 'SUCCESS'
        AND action IN ('dlq.admin.reprocess', 'dlq.entry.reprocess')`,
    [fixture.tenantId, correlationId],
  );
  return Number(result.rows[0]?.count || 0);
}

async function apiJson(url, options) {
  const response = await fetch(url, { ...options, redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  let body = null;
  if (contentType.includes('application/json') || contentType.includes('application/problem+json')) {
    body = await response.json();
  } else {
    const text = await response.text();
    body = text ? { text: text.slice(0, 500) } : null;
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`DLQ Admin smoke received unexpected redirect HTTP ${response.status}`);
  }
  return { response, body };
}

function responseCookies(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (values.length > 0) {
    return values.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');
  }
  const single = headers.get('set-cookie');
  return single ? single.split(';', 1)[0] : '';
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function requiredUrl(value, field) {
  const candidate = requiredText(value, field).replace(/\/$/, '');
  const url = new URL(candidate);
  if (url.protocol !== 'https:') {
    throw new Error(`${field} must use HTTPS`);
  }
  return url.toString().replace(/\/$/, '');
}

function requiredOrigin(value, field) {
  const candidate = requiredUrl(value, field);
  const url = new URL(candidate);
  if (url.pathname !== '/' || url.search || url.hash || candidate !== url.origin) {
    throw new Error(`${field} must be an HTTPS origin without path, query or fragment`);
  }
  return url.origin;
}

function safeRunIdentity(value) {
  return String(value).replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 48) || randomUUID().replaceAll('-', '');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
  return `${code}:${error?.name || 'Error'}`;
}
