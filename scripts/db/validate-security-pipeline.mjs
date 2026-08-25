import assert from 'node:assert/strict';
import pg from 'pg';
import { AuthorizedTenantOperationService } from '../../src/modules/security/authorized-tenant-operation.js';

const { Pool } = pg;

const IDS = Object.freeze({
  tenantA: '01990000-1000-7000-8000-000000000001',
  tenantB: '01990000-1000-7000-8000-000000000002',
  user: '01990000-1000-7000-8000-000000000100',
  externalIdentity: '01990000-1000-7000-8000-000000000101',
  membership: '01990000-1000-7000-8000-000000000102',
  companyA: '01990000-1000-7000-8000-000000000201',
  companyB: '01990000-1000-7000-8000-000000000202',
  permission: '01990000-1000-7000-8000-000000000301',
  role: '01990000-1000-7000-8000-000000000302',
  assignment: '01990000-1000-7000-8000-000000000303',
  scopeA: '01990000-1000-7000-8000-000000000304',
});

const CORRELATION_ID = 'ci-p1-security-pipeline';
const APP_ROLE = process.env.MVT_PIPELINE_APP_ROLE ?? 'moventra_app_ci';

const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'moventra_ci',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  max: 4,
  connectionTimeoutMillis: 5_000,
  application_name: 'moventra-security-pipeline-validation',
});

try {
  await assertValidationRole();
  await seedFixture();

  const service = new AuthorizedTenantOperationService({
    transaction: runtimeTransaction,
  });

  const success = await service.execute(
    operationRequest({
      permission: 'operations.company.update',
      companyId: IDS.companyA,
      requestId: 'ci-p1-allow',
      action: 'company.update',
    }),
    async ({ query, tenantId }) => {
      const crossTenant = await query(
        'SELECT count(*)::int AS visible FROM organization.tenants WHERE id = $1',
        [IDS.tenantB],
      );
      assert.equal(Number(crossTenant.rows[0]?.visible ?? -1), 0, 'Tenant B must be invisible');

      const updated = await query(
        `UPDATE organization.companies
            SET display_name = 'P1 Company A Updated',
                updated_at = now(),
                version = version + 1
          WHERE tenant_id = $1 AND id = $2
        RETURNING id, display_name, version`,
        [tenantId, IDS.companyA],
      );
      assert.equal(updated.rows.length, 1, 'Authorized company mutation must affect one row');
      return {
        companyId: updated.rows[0].id,
        displayName: updated.rows[0].display_name,
      };
    },
  );

  assert.deepEqual(success, {
    companyId: IDS.companyA,
    displayName: 'P1 Company A Updated',
  });

  let deniedOperationExecuted = false;
  await assert.rejects(
    () => service.execute(
      operationRequest({
        permission: 'operations.company.delete',
        companyId: IDS.companyA,
        requestId: 'ci-p1-rbac-deny',
        action: 'company.delete',
      }),
      async () => {
        deniedOperationExecuted = true;
      },
    ),
    (error) => error?.code === 'MVT_RBAC_FORBIDDEN',
  );
  assert.equal(deniedOperationExecuted, false, 'RBAC denied operation must not execute');

  let scopeDeniedOperationExecuted = false;
  await assert.rejects(
    () => service.execute(
      operationRequest({
        permission: 'operations.company.update',
        companyId: IDS.companyB,
        requestId: 'ci-p1-scope-deny',
        action: 'company.update',
      }),
      async () => {
        scopeDeniedOperationExecuted = true;
      },
    ),
    (error) => error?.code === 'MVT_SCOPE_FORBIDDEN',
  );
  assert.equal(scopeDeniedOperationExecuted, false, 'Scope denied operation must not execute');

  await verifyEvidence();
  console.log('security_pipeline_validation=success');
} finally {
  await pool.end();
}

async function assertValidationRole() {
  const result = await pool.query(
    `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles
      WHERE rolname = $1`,
    [APP_ROLE],
  );
  assert.equal(result.rows.length, 1, `Validation app role ${APP_ROLE} must exist`);
  const role = result.rows[0];
  assert.equal(role.rolcanlogin, true);
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolcreatedb, false);
  assert.equal(role.rolcreaterole, false);
  assert.equal(role.rolreplication, false);
  assert.equal(role.rolbypassrls, false);
}

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO organization.tenants
         (id, code, display_name, status, default_timezone, default_currency)
       VALUES
         ($1, 'ci-p1-a', 'CI P1 Tenant A', 'ACTIVE', 'UTC', 'USD'),
         ($2, 'ci-p1-b', 'CI P1 Tenant B', 'ACTIVE', 'UTC', 'USD')`,
      [IDS.tenantA, IDS.tenantB],
    );

    await client.query(
      `INSERT INTO organization.companies
         (id, tenant_id, code, legal_name, display_name, registration_country, status)
       VALUES
         ($1, $3, 'ci-company-a', 'CI Company A LLC', 'P1 Company A', 'US', 'ACTIVE'),
         ($2, $3, 'ci-company-b', 'CI Company B LLC', 'P1 Company B', 'US', 'ACTIVE')`,
      [IDS.companyA, IDS.companyB, IDS.tenantA],
    );

    await client.query(
      `INSERT INTO identity.users (id, primary_email, display_name, status)
       VALUES ($1, 'p1-security-pipeline@example.invalid', 'P1 Security Pipeline', 'ACTIVE')`,
      [IDS.user],
    );

    await client.query(
      `INSERT INTO identity.external_identities
         (id, user_id, provider_key, issuer, subject, status)
       VALUES ($1, $2, 'ci-provider', 'https://issuer.example.invalid/p1', 'ci-p1-user', 'ACTIVE')`,
      [IDS.externalIdentity, IDS.user],
    );

    await client.query(
      `INSERT INTO identity.memberships (id, tenant_id, user_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [IDS.membership, IDS.tenantA, IDS.user],
    );

    await client.query(
      `INSERT INTO security.permissions (id, code, description, status)
       VALUES ($1, 'operations.company.update', 'Update company within authorized scope', 'ACTIVE')`,
      [IDS.permission],
    );

    await client.query(
      `INSERT INTO security.roles (id, tenant_id, code, name, status)
       VALUES ($1, $2, 'ci-operator', 'CI Operator', 'ACTIVE')`,
      [IDS.role, IDS.tenantA],
    );

    await client.query(
      `INSERT INTO security.role_permissions (tenant_id, role_id, permission_id)
       VALUES ($1, $2, $3)`,
      [IDS.tenantA, IDS.role, IDS.permission],
    );

    await client.query(
      `INSERT INTO security.membership_roles
         (id, tenant_id, membership_id, role_id, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')`,
      [IDS.assignment, IDS.tenantA, IDS.membership, IDS.role],
    );

    await client.query(
      `INSERT INTO security.organizational_scopes
         (id, tenant_id, scope_level, company_id, branch_id, status)
       VALUES ($1, $2, 'COMPANY', $3, NULL, 'ACTIVE')`,
      [IDS.scopeA, IDS.tenantA, IDS.companyA],
    );

    await client.query(
      `INSERT INTO security.role_assignment_scopes (tenant_id, assignment_id, scope_id)
       VALUES ($1, $2, $3)`,
      [IDS.tenantA, IDS.assignment, IDS.scopeA],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runtimeTransaction(tenantId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(APP_ROLE)}`);
    await client.query(
      "SELECT set_config('moventra.tenant_id', $1, true) AS tenant_id",
      [tenantId],
    );
    const result = await callback(client, tenantId);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function operationRequest({ permission, companyId, requestId, action }) {
  return {
    tenantId: IDS.tenantA,
    verifiedAssertion: {
      providerKey: 'ci-provider',
      issuer: 'https://issuer.example.invalid/p1',
      subject: 'ci-p1-user',
    },
    permission,
    scope: { level: 'COMPANY', companyId },
    audit: {
      category: 'security',
      action,
      entityType: 'company',
      entityId: companyId,
      requestId,
      correlationId: CORRELATION_ID,
      metadata: { validation: 'p1-security-pipeline' },
    },
  };
}

async function verifyEvidence() {
  const company = await pool.query(
    'SELECT display_name FROM organization.companies WHERE id = $1',
    [IDS.companyA],
  );
  assert.equal(company.rows[0]?.display_name, 'P1 Company A Updated');

  const audit = await pool.query(
    `SELECT outcome, reason, actor_user_id, actor_membership_id, company_id, request_id
       FROM audit.audit_events
      WHERE correlation_id = $1
      ORDER BY request_id`,
    [CORRELATION_ID],
  );

  assert.equal(audit.rows.length, 3, 'Expected SUCCESS plus two DENIED audit events');
  const byRequest = new Map(audit.rows.map((row) => [row.request_id, row]));
  assert.equal(byRequest.get('ci-p1-allow')?.outcome, 'SUCCESS');
  assert.equal(byRequest.get('ci-p1-rbac-deny')?.outcome, 'DENIED');
  assert.equal(byRequest.get('ci-p1-rbac-deny')?.reason, 'MVT_RBAC_FORBIDDEN');
  assert.equal(byRequest.get('ci-p1-scope-deny')?.outcome, 'DENIED');
  assert.equal(byRequest.get('ci-p1-scope-deny')?.reason, 'MVT_SCOPE_FORBIDDEN');

  for (const row of audit.rows) {
    assert.equal(row.actor_user_id, IDS.user);
    assert.equal(row.actor_membership_id, IDS.membership);
  }
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error('MVT_PIPELINE_APP_ROLE contains invalid characters');
  }
  return `"${value.replaceAll('"', '""')}"`;
}
