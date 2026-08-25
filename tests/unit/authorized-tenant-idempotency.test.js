import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizedTenantOperationService } from '../../src/modules/security/authorized-tenant-operation.js';

const TENANT_ID = '01990220-0000-7000-8000-000000000001';
const USER_ID = '01990220-0000-7000-8000-000000000100';
const MEMBERSHIP_ID = '01990220-0000-7000-8000-000000000101';

function request() {
  return {
    tenantId: TENANT_ID,
    verifiedAssertion: {
      providerKey: 'ci-provider',
      issuer: 'https://issuer.example.invalid',
      subject: 'user-100',
    },
    permission: 'operations.freight.contract',
    scope: { level: 'TENANT' },
    audit: {
      category: 'operation',
      action: 'freight.contract',
      entityType: 'freight',
      entityId: 'freight-1',
      requestId: 'req-1',
      correlationId: 'corr-1',
    },
    idempotency: {
      key: '01JTESTIDEMPOTENCYKEY000001',
      operationKey: 'freight.contract.create',
      fingerprintInput: { freightId: 'freight-1', amount: 1500 },
      responseStatus: 201,
      responseHeaders: { location: '/freights/freight-1' },
    },
  };
}

test('authorized idempotent replay does not duplicate business effect or SUCCESS audit', async () => {
  const audits = [];
  let operationCalls = 0;
  let idempotencyCalls = 0;
  let storedBody;

  const components = {
    auth: {
      resolveForTenant: async () => ({
        user: { id: USER_ID, status: 'ACTIVE' },
        membership: { id: MEMBERSHIP_ID, tenantId: TENANT_ID, status: 'ACTIVE' },
        externalIdentity: { id: '01990220-0000-7000-8000-000000000102', status: 'ACTIVE' },
      }),
    },
    authorization: { requirePermission: async () => true },
    scopes: { hasScopedPermission: async () => true },
    audit: {
      append: async (event) => {
        audits.push(event);
        return { id: '01990220-0000-7000-8000-000000000900' };
      },
    },
  };

  const idempotency = {
    execute: async (input) => {
      idempotencyCalls += 1;
      if (storedBody === undefined) {
        storedBody = await input.execute();
        return {
          outcome: 'executed',
          replayed: false,
          response: {
            status: input.responseStatus,
            mediaType: input.responseMediaType,
            body: storedBody,
            headers: input.responseHeaders,
          },
        };
      }
      return {
        outcome: 'replayed',
        replayed: true,
        response: {
          status: 201,
          mediaType: 'application/json',
          body: storedBody,
          headers: { location: '/freights/freight-1' },
        },
      };
    },
  };

  const service = new AuthorizedTenantOperationService({
    transaction: async (tenantId, callback) => {
      assert.equal(tenantId, TENANT_ID);
      return callback({ query: async () => ({ rows: [], rowCount: 0 }) }, tenantId);
    },
    componentsFactory: () => components,
    idempotencyFactory: () => idempotency,
  });

  const operation = async (context) => {
    operationCalls += 1;
    assert.equal(context.tenantId, TENANT_ID);
    return { freightId: 'freight-1', status: 'CONTRACTED' };
  };

  const first = await service.execute(request(), operation);
  const second = await service.execute(request(), operation);

  assert.equal(operationCalls, 1);
  assert.equal(idempotencyCalls, 2);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'SUCCESS');
  assert.deepEqual(first.value, { freightId: 'freight-1', status: 'CONTRACTED' });
  assert.equal(first.idempotency.replayed, false);
  assert.deepEqual(second.value, first.value);
  assert.equal(second.idempotency.replayed, true);
  assert.equal(second.idempotency.status, 201);
});

test('non-idempotent authorized operations preserve the pre-022 return contract', async () => {
  const audits = [];
  const service = new AuthorizedTenantOperationService({
    transaction: async (tenantId, callback) => callback({ query: async () => ({ rows: [] }) }, tenantId),
    componentsFactory: () => ({
      auth: {
        resolveForTenant: async () => ({
          user: { id: USER_ID },
          membership: { id: MEMBERSHIP_ID },
          externalIdentity: { id: 'identity-1' },
        }),
      },
      authorization: { requirePermission: async () => true },
      scopes: { hasScopedPermission: async () => true },
      audit: { append: async (event) => audits.push(event) },
    }),
  });

  const result = await service.execute(
    { ...request(), idempotency: null },
    async () => ({ unchanged: true }),
  );

  assert.deepEqual(result, { unchanged: true });
  assert.equal(audits.length, 1);
});
