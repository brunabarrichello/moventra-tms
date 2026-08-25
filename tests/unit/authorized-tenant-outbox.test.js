import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorizedOutbox } from '../../src/modules/outbox/authorized-outbox.js';
import { defineOutboxEventContract } from '../../src/modules/outbox/outbox-contract.js';
import { AuthorizedTenantOperationService } from '../../src/modules/security/authorized-tenant-operation.js';

const TENANT_ID = '01990234-0000-7000-8000-000000000001';
const USER_ID = '01990234-0000-7000-8000-000000000100';
const MEMBERSHIP_ID = '01990234-0000-7000-8000-000000000101';
const FREIGHT_CONTRACTED = defineOutboxEventContract({
  aggregateType: 'freight',
  eventType: 'freight.contracted',
  schemaVersion: 1,
});

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
    },
    idempotency: {
      key: '01JTESTOUTBOXIDEMPOTENCY0001',
      operationKey: 'freight.contract.create',
      fingerprintInput: { freightId: 'freight-1' },
    },
  };
}

test('authorized idempotent replay does not execute a second outbox append', async () => {
  const audits = [];
  const outboxAppends = [];
  let operationCalls = 0;
  let storedBody;
  const sharedQuery = async () => ({ rows: [], rowCount: 0 });

  const components = {
    auth: {
      resolveForTenant: async () => ({
        user: { id: USER_ID },
        membership: { id: MEMBERSHIP_ID },
        externalIdentity: { id: '01990234-0000-7000-8000-000000000102' },
      }),
    },
    authorization: { requirePermission: async () => true },
    scopes: { hasScopedPermission: async () => true },
    audit: { append: async (event) => audits.push(event) },
  };

  const idempotency = {
    execute: async (input) => {
      if (storedBody === undefined) {
        storedBody = await input.execute();
        return {
          outcome: 'executed', replayed: false,
          response: { status: 200, mediaType: 'application/json', body: storedBody, headers: {} },
        };
      }
      return {
        outcome: 'replayed', replayed: true,
        response: { status: 200, mediaType: 'application/json', body: storedBody, headers: {} },
      };
    },
  };

  const service = new AuthorizedTenantOperationService({
    transaction: async (tenantId, callback) => {
      assert.equal(tenantId, TENANT_ID);
      return callback({ query: sharedQuery }, tenantId);
    },
    componentsFactory: () => components,
    idempotencyFactory: () => idempotency,
  });

  const operation = async (context) => {
    operationCalls += 1;
    const outbox = createAuthorizedOutbox(context, {
      serviceFactory: (query) => {
        assert.equal(query, sharedQuery);
        return {
          append: async (input) => {
            outboxAppends.push(input);
            return { id: '01990234-0000-7000-8000-000000000900' };
          },
        };
      },
    });

    await outbox.append({
      contract: FREIGHT_CONTRACTED,
      aggregateId: '01990234-0000-7000-8000-000000000200',
      payload: { freightId: 'freight-1' },
    });
    return { freightId: 'freight-1', status: 'CONTRACTED' };
  };

  const first = await service.execute(request(), operation);
  const replay = await service.execute(request(), operation);

  assert.equal(operationCalls, 1);
  assert.equal(outboxAppends.length, 1);
  assert.equal(outboxAppends[0].tenantId, TENANT_ID);
  assert.equal(audits.length, 1);
  assert.equal(first.idempotency.replayed, false);
  assert.equal(replay.idempotency.replayed, true);
});
