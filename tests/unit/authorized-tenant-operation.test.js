import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizedTenantOperationService } from '../../src/modules/security/authorized-tenant-operation.js';

const TENANT_ID = '01990000-0000-7000-8000-000000000001';
const USER_ID = '01990000-0000-7000-8000-000000000100';
const MEMBERSHIP_ID = '01990000-0000-7000-8000-000000000101';
const COMPANY_ID = '01990000-0000-7000-8000-000000000201';

function request(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    verifiedAssertion: {
      providerKey: 'ci-provider',
      issuer: 'https://issuer.example.invalid',
      subject: 'user-100',
    },
    permission: 'operations.company.update',
    scope: { level: 'COMPANY', companyId: COMPANY_ID },
    audit: {
      category: 'security',
      action: 'company.update',
      entityType: 'company',
      entityId: COMPANY_ID,
      requestId: 'req-1',
      correlationId: 'corr-1',
      metadata: { source: 'unit-test' },
    },
    ...overrides,
  };
}

function principal() {
  return {
    user: { id: USER_ID, status: 'ACTIVE' },
    membership: { id: MEMBERSHIP_ID, tenantId: TENANT_ID, status: 'ACTIVE' },
    externalIdentity: { id: '01990000-0000-7000-8000-000000000102', status: 'ACTIVE' },
  };
}

function harness({ permissionError = null, scoped = true, auditError = null } = {}) {
  const audits = [];
  const calls = { transactions: 0, operation: 0, scoped: 0, permission: 0 };
  const components = {
    auth: { resolveForTenant: async () => principal() },
    authorization: {
      requirePermission: async () => {
        calls.permission += 1;
        if (permissionError) throw permissionError;
        return true;
      },
    },
    scopes: {
      hasScopedPermission: async () => {
        calls.scoped += 1;
        return scoped;
      },
    },
    audit: {
      append: async (event) => {
        if (auditError) throw auditError;
        audits.push(event);
        return { id: '01990000-0000-7000-8000-000000000900' };
      },
    },
  };

  const service = new AuthorizedTenantOperationService({
    transaction: async (tenantId, callback) => {
      calls.transactions += 1;
      assert.equal(tenantId, TENANT_ID);
      return callback({ query: async () => ({ rows: [] }) }, tenantId);
    },
    componentsFactory: () => components,
  });

  return { service, audits, calls };
}

test('authorized tenant operation chains auth, RBAC, scope, operation and SUCCESS audit', async () => {
  const { service, audits, calls } = harness();

  const result = await service.execute(request(), async (context) => {
    calls.operation += 1;
    assert.equal(context.tenantId, TENANT_ID);
    assert.equal(context.user.id, USER_ID);
    assert.equal(context.membership.id, MEMBERSHIP_ID);
    assert.equal(context.permission, 'operations.company.update');
    assert.deepEqual(context.scope, { level: 'COMPANY', companyId: COMPANY_ID, branchId: null });
    return { updated: true };
  });

  assert.deepEqual(result, { updated: true });
  assert.equal(calls.transactions, 1);
  assert.equal(calls.permission, 1);
  assert.equal(calls.scoped, 1);
  assert.equal(calls.operation, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'SUCCESS');
  assert.equal(audits[0].actorUserId, USER_ID);
  assert.equal(audits[0].actorMembershipId, MEMBERSHIP_ID);
  assert.equal(audits[0].companyId, COMPANY_ID);
  assert.equal(audits[0].metadata.securityContext.permission, 'operations.company.update');
});

test('RBAC denial does not run operation and records DENIED in a separate transaction', async () => {
  const error = new Error('Permission denied');
  error.code = 'MVT_RBAC_FORBIDDEN';
  const { service, audits, calls } = harness({ permissionError: error });

  await assert.rejects(
    () => service.execute(request(), async () => {
      calls.operation += 1;
    }),
    (caught) => caught === error,
  );

  assert.equal(calls.transactions, 2);
  assert.equal(calls.operation, 0);
  assert.equal(calls.scoped, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'DENIED');
  assert.equal(audits[0].reason, 'MVT_RBAC_FORBIDDEN');
  assert.equal(audits[0].actorMembershipId, MEMBERSHIP_ID);
});

test('organizational scope denial is deny-by-default and is audited', async () => {
  const { service, audits, calls } = harness({ scoped: false });

  await assert.rejects(
    () => service.execute(request(), async () => {
      calls.operation += 1;
    }),
    (error) => error.code === 'MVT_SCOPE_FORBIDDEN',
  );

  assert.equal(calls.transactions, 2);
  assert.equal(calls.operation, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'DENIED');
  assert.equal(audits[0].reason, 'MVT_SCOPE_FORBIDDEN');
});

test('operation failure rolls back primary transaction path and records FAILED outcome', async () => {
  const { service, audits, calls } = harness();
  const failure = new Error('Synthetic operation failure');
  failure.code = 'MVT_TEST_OPERATION_FAILED';

  await assert.rejects(
    () => service.execute(request(), async () => {
      calls.operation += 1;
      throw failure;
    }),
    (error) => error === failure,
  );

  assert.equal(calls.transactions, 2);
  assert.equal(calls.operation, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'FAILED');
  assert.equal(audits[0].reason, 'MVT_TEST_OPERATION_FAILED');
});

test('raw or missing authentication assertion is rejected before database execution', async () => {
  const { service, calls } = harness();

  await assert.rejects(
    () => service.execute(request({ verifiedAssertion: null }), async () => true),
    (error) => error.code === 'MVT_SECURITY_ASSERTION_INVALID',
  );

  assert.equal(calls.transactions, 0);
});

test('audit fallback failure never replaces the original authorization error', async () => {
  const denied = new Error('Permission denied');
  denied.code = 'MVT_RBAC_FORBIDDEN';
  const auditFailure = new Error('Audit unavailable');
  auditFailure.code = 'MVT_AUDIT_WRITE_FAILED';
  const { service } = harness({ permissionError: denied, auditError: auditFailure });

  await assert.rejects(
    () => service.execute(request(), async () => true),
    (error) => error === denied && error.auditFailureCode === 'MVT_AUDIT_WRITE_FAILED',
  );
});
