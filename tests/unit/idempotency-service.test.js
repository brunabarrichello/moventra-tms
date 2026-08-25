import assert from 'node:assert/strict';
import test from 'node:test';
import { ERROR_CODES } from '../../src/core/errors/error-codes.js';
import { mapErrorToHttp } from '../../src/http/error-mapper.js';
import { IdempotencyService } from '../../src/modules/idempotency/idempotency-service.js';

const TENANT_ID = '01990220-0000-7000-8000-000000000001';
const OPERATION = 'freight.contract.create';
const KEY = '01JTESTIDEMPOTENCYKEY000001';

class MemoryRepository {
  constructor() {
    this.record = null;
    this.claims = 0;
    this.completions = 0;
  }

  async claim(input) {
    this.claims += 1;
    if (this.record) {
      return { acquired: false, record: this.record };
    }
    this.record = Object.freeze({
      id: '01990220-0000-7000-8000-000000000010',
      tenantId: input.tenantId,
      operationKey: input.operationKey,
      keyHashVersion: input.keyHashVersion,
      fingerprint: input.fingerprint,
      fingerprintVersion: input.fingerprintVersion,
      state: 'PROCESSING',
      responseStatus: null,
      responseMediaType: null,
      responseBody: null,
      responseHeaders: Object.freeze({}),
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      expiresAt: input.expiresAt,
    });
    return { acquired: true, record: this.record };
  }

  async complete(input) {
    this.completions += 1;
    this.record = Object.freeze({
      ...this.record,
      state: 'COMPLETED',
      responseStatus: input.responseStatus,
      responseMediaType: input.responseMediaType,
      responseBody: input.responseBody,
      responseHeaders: Object.freeze({ ...input.responseHeaders }),
      completedAt: '2026-01-01T00:00:01.000Z',
    });
    return this.record;
  }
}

function createHarness() {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const repository = new MemoryRepository();
  const service = new IdempotencyService({
    repository,
    ttlMs: 60_000,
    clock: () => now,
  });
  return {
    repository,
    service,
    advance(ms) {
      now += ms;
    },
  };
}

test('first execution stores a safe result and second execution replays without another effect', async () => {
  const { service, repository } = createHarness();
  let effects = 0;
  const request = {
    tenantId: TENANT_ID,
    operationKey: OPERATION,
    idempotencyKey: KEY,
    fingerprintInput: { freightId: 'freight-1', price: 1500 },
    responseStatus: 201,
    responseMediaType: 'application/json',
    responseHeaders: {
      location: '/freights/freight-1',
      authorization: 'must-not-be-stored',
      cookie: 'must-not-be-stored',
    },
    execute: async () => {
      effects += 1;
      return { id: 'freight-1', status: 'CONTRACTED' };
    },
  };

  const first = await service.execute(request);
  const second = await service.execute({
    ...request,
    execute: async () => {
      effects += 1;
      return { id: 'should-not-run' };
    },
  });

  assert.equal(first.outcome, 'executed');
  assert.equal(first.replayed, false);
  assert.equal(second.outcome, 'replayed');
  assert.equal(second.replayed, true);
  assert.equal(effects, 1);
  assert.equal(repository.claims, 2);
  assert.equal(repository.completions, 1);
  assert.deepEqual(second.response.body, { id: 'freight-1', status: 'CONTRACTED' });
  assert.deepEqual(second.response.headers, { location: '/freights/freight-1' });
});

test('same key with a different semantic fingerprint fails with stable 409 code', async () => {
  const { service } = createHarness();
  await service.execute({
    tenantId: TENANT_ID,
    operationKey: OPERATION,
    idempotencyKey: KEY,
    fingerprintInput: { freightId: 'freight-1', price: 1500 },
    execute: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => service.execute({
      tenantId: TENANT_ID,
      operationKey: OPERATION,
      idempotencyKey: KEY,
      fingerprintInput: { freightId: 'freight-1', price: 1600 },
      execute: async () => ({ shouldNotRun: true }),
    }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IDEMPOTENCY_REQUEST_MISMATCH);
      assert.equal(mapErrorToHttp(error).status, 409);
      return true;
    },
  );
});

test('missing Idempotency-Key fails before claim with a public 400 contract', async () => {
  const { service, repository } = createHarness();
  await assert.rejects(
    () => service.execute({
      tenantId: TENANT_ID,
      operationKey: OPERATION,
      idempotencyKey: '',
      fingerprintInput: { freightId: 'freight-1' },
      execute: async () => ({ ok: true }),
    }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED);
      assert.equal(mapErrorToHttp(error).status, 400);
      return true;
    },
  );
  assert.equal(repository.claims, 0);
});

test('expired stored result fails closed instead of silently creating a duplicate effect', async () => {
  const { service, advance } = createHarness();
  let effects = 0;
  const common = {
    tenantId: TENANT_ID,
    operationKey: OPERATION,
    idempotencyKey: KEY,
    fingerprintInput: { freightId: 'freight-1' },
  };

  await service.execute({ ...common, execute: async () => { effects += 1; return { ok: true }; } });
  advance(60_001);

  await assert.rejects(
    () => service.execute({ ...common, execute: async () => { effects += 1; return { duplicate: true }; } }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE);
      assert.equal(mapErrorToHttp(error).status, 503);
      return true;
    },
  );
  assert.equal(effects, 1);
});

test('undefined and oversized results fail instead of creating an unreplayable completed record', async () => {
  const first = createHarness();
  await assert.rejects(
    () => first.service.execute({
      tenantId: TENANT_ID,
      operationKey: OPERATION,
      idempotencyKey: KEY,
      fingerprintInput: { freightId: 'freight-1' },
      execute: async () => undefined,
    }),
    (error) => error.code === ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE,
  );
  assert.equal(first.repository.completions, 0);

  const second = createHarness();
  await assert.rejects(
    () => second.service.execute({
      tenantId: TENANT_ID,
      operationKey: OPERATION,
      idempotencyKey: '01JTESTIDEMPOTENCYKEY000002',
      fingerprintInput: { freightId: 'freight-2' },
      execute: async () => ({ payload: 'x'.repeat(70 * 1024) }),
    }),
    (error) => error.code === ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE,
  );
  assert.equal(second.repository.completions, 0);
});
