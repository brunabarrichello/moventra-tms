import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigurationService } from '../../src/modules/configuration/configuration-service.js';

const tenantId = '01990180-0000-7000-8000-000000000001';
const companyId = '01990180-0000-7000-8000-000000000011';
const branchId = '01990180-0000-7000-8000-000000000021';
const verifiedAssertion = {
  providerKey: 'oidc-test',
  issuer: 'https://issuer.example.invalid',
  subject: 'user-1',
};

function captureSecurity() {
  const calls = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      return request;
    },
  };
}

test('effective configuration read requires read permission and organizational scope', async () => {
  const security = captureSecurity();
  const service = new ConfigurationService({ security });

  await service.resolveEffective({
    tenantId,
    verifiedAssertion,
    configurationKey: 'operations.tracking.enabled',
    companyId,
    branchId,
  });

  assert.equal(security.calls[0].permission, 'configuration.settings.read');
  assert.deepEqual(security.calls[0].scope, {
    level: 'BRANCH', companyId, branchId,
  });
  assert.equal(security.calls[0].audit.action, 'configuration.effective.resolved');
});

test('configuration writes require manage permission and never place value in audit metadata', async () => {
  const security = captureSecurity();
  const service = new ConfigurationService({ security });

  await service.putOverride({
    tenantId,
    verifiedAssertion,
    configurationKey: 'operations.tracking.enabled',
    scope: { type: 'COMPANY', companyId },
    value: true,
    reason: 'enable for company',
  });

  const request = security.calls[0];
  assert.equal(request.permission, 'configuration.settings.manage');
  assert.equal(request.audit.action, 'configuration.setting.created');
  assert.equal(request.audit.metadata.valueIncluded, false);
  assert.equal(Object.hasOwn(request.audit.metadata, 'value'), false);
});

test('status transitions are authorized by the same canonical security pipeline', async () => {
  const security = captureSecurity();
  const service = new ConfigurationService({ security });

  await service.transitionOverrideStatus({
    tenantId,
    verifiedAssertion,
    settingId: '01990180-0000-7000-8000-000000000101',
    scope: { type: 'TENANT' },
    toStatus: 'INACTIVE',
    expectedVersion: 2,
    reason: 'fallback to default',
  });

  assert.equal(security.calls[0].permission, 'configuration.settings.manage');
  assert.equal(security.calls[0].audit.action, 'configuration.setting.inactivated');
  assert.equal(security.calls[0].scope.level, 'TENANT');
});
