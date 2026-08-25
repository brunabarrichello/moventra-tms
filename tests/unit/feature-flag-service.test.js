import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FeatureFlagAdministrationService,
  FeatureFlagEvaluator,
} from '../../src/modules/feature-flags/feature-flag-service.js';

const tenantId = '01990190-0000-7000-8000-000000000001';
const companyId = '01990190-0000-7000-8000-000000000011';
const branchId = '01990190-0000-7000-8000-000000000021';
const userId = '01990190-0000-7000-8000-000000000031';
const membershipId = '01990190-0000-7000-8000-000000000041';

test('evaluator derives environment, User, scope and Plan only from trusted authorized context/providers', async () => {
  const query = async () => ({ rows: [] });
  let captured = null;
  const evaluator = new FeatureFlagEvaluator({
    environmentProvider: async () => 'staging',
    planContextProvider: async ({ tenantId: providedTenantId }) => {
      assert.equal(providedTenantId, tenantId);
      return 'Enterprise';
    },
    repositoryFactory: (providedQuery) => {
      assert.equal(providedQuery, query);
      return {
        evaluate: async (providedTenantId, key, input) => {
          captured = { providedTenantId, key, input };
          return { enabled: true, source: 'BRANCH' };
        },
      };
    },
  });

  const result = await evaluator.evaluateAuthorizedContext({
    featureFlagKey: 'operations.trips.new-dispatch',
    environment: 'production',
    planKey: 'client-supplied-must-be-ignored',
    authorizedContext: {
      tenantId,
      user: { id: userId },
      membership: { id: membershipId },
      scope: { level: 'BRANCH', companyId, branchId },
      query,
    },
  });

  assert.deepEqual(result, { enabled: true, source: 'BRANCH' });
  assert.deepEqual(captured, {
    providedTenantId: tenantId,
    key: 'operations.trips.new-dispatch',
    input: {
      environment: 'staging',
      userId,
      companyId,
      branchId,
      planKey: 'enterprise',
    },
  });
});

test('evaluator refuses a context that was not already authorized and transaction-bound', async () => {
  const evaluator = new FeatureFlagEvaluator({ environmentProvider: () => 'staging' });
  await assert.rejects(
    evaluator.evaluateAuthorizedContext({
      featureFlagKey: 'operations.trips.new-dispatch',
      authorizedContext: { tenantId, user: { id: userId }, membership: { id: membershipId } },
    }),
    { code: 'MVT_FEATURE_FLAG_AUTHORIZED_CONTEXT_INVALID' },
  );
});

test('administrative writes use feature_flags.rules.manage and Organizational Scope without auditing flag values', async () => {
  const security = {
    execute: async (request) => request,
  };
  const service = new FeatureFlagAdministrationService({ security });
  const result = await service.putRule({
    tenantId,
    verifiedAssertion: { providerKey: 'oidc', issuer: 'issuer', subject: 'subject' },
    featureFlagKey: 'operations.trips.new-dispatch',
    environment: 'production',
    target: { type: 'BRANCH', companyId, branchId },
    enabled: true,
    rolloutBasisPoints: 2500,
    requestId: 'req-019',
  });

  assert.equal(result.permission, 'feature_flags.rules.manage');
  assert.deepEqual(result.scope, { level: 'BRANCH', companyId, branchId });
  assert.equal(result.audit.action, 'feature_flag.rule.created');
  assert.equal(result.audit.metadata.valueIncluded, false);
  assert.equal(Object.hasOwn(result.audit.metadata, 'enabled'), false);
});
