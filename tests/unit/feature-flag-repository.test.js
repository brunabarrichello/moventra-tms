import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresFeatureFlagRepository } from '../../src/modules/feature-flags/feature-flag-repository.js';

const tenantId = '01990190-0000-7000-8000-000000000001';
const companyId = '01990190-0000-7000-8000-000000000011';
const branchId = '01990190-0000-7000-8000-000000000021';
const userId = '01990190-0000-7000-8000-000000000031';
const flagId = '01990190-0000-7000-8000-000000000100';
const ruleId = '01990190-0000-7000-8000-000000000104';

function flagRow(overrides = {}) {
  return {
    id: flagId,
    key: 'operations.trips.new-dispatch',
    name: 'New dispatch',
    description: null,
    default_enabled: false,
    status: 'ACTIVE',
    hash_version: 1,
    created_at: new Date('2026-08-25T00:00:00Z'),
    updated_at: new Date('2026-08-25T00:00:00Z'),
    version: '1',
    ...overrides,
  };
}

function policyRow(overrides = {}) {
  return {
    id: '01990190-0000-7000-8000-000000000101',
    flag_id: flagId,
    environment: 'staging',
    enabled: true,
    rollout_basis_points: 10000,
    status: 'ACTIVE',
    created_at: new Date('2026-08-25T00:00:00Z'),
    updated_at: new Date('2026-08-25T00:00:00Z'),
    version: '1',
    ...overrides,
  };
}

function ruleRow(overrides = {}) {
  return {
    id: ruleId,
    tenant_id: tenantId,
    flag_id: flagId,
    environment: null,
    target_type: 'USER',
    company_id: null,
    branch_id: null,
    user_id: userId,
    plan_key: null,
    enabled: false,
    rollout_basis_points: 10000,
    status: 'ACTIVE',
    created_at: new Date('2026-08-25T00:00:00Z'),
    updated_at: new Date('2026-08-25T00:00:00Z'),
    version: '7',
    ...overrides,
  };
}

test('USER rule wins before Branch, Company, Tenant, Plan and environment fallback', async () => {
  const ruleTargetsQueried = [];
  const query = async (sql, values) => {
    if (sql.includes('FROM organization.branches')) {
      return { rows: [{ exists: true }] };
    }
    if (sql.includes('FROM identity.memberships')) {
      return { rows: [{ exists: true }] };
    }
    if (sql.includes('FROM feature_flags.flags')) {
      return { rows: [flagRow()] };
    }
    if (sql.includes('FROM feature_flags.environment_policies')) {
      return { rows: [policyRow()] };
    }
    if (sql.includes('FROM feature_flags.rules')) {
      const targetType = values[2];
      ruleTargetsQueried.push(targetType);
      return { rows: targetType === 'USER' ? [ruleRow()] : [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresFeatureFlagRepository({ query });
  const result = await repository.evaluate(tenantId, 'operations.trips.new-dispatch', {
    environment: 'staging',
    companyId,
    branchId,
    userId,
    planKey: 'enterprise',
  });

  assert.equal(result.source, 'USER');
  assert.equal(result.enabled, false);
  assert.equal(result.ruleId, ruleId);
  assert.deepEqual(ruleTargetsQueried, ['USER']);
});

test('disabled environment policy is a global environment kill-switch before tenant rules', async () => {
  let tenantRuleRead = false;
  const query = async (sql) => {
    if (sql.includes('FROM feature_flags.flags')) {
      return { rows: [flagRow()] };
    }
    if (sql.includes('FROM feature_flags.environment_policies')) {
      return { rows: [policyRow({ enabled: false, rollout_basis_points: 10000 })] };
    }
    if (sql.includes('FROM feature_flags.rules')) {
      tenantRuleRead = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresFeatureFlagRepository({ query });
  const result = await repository.evaluate(tenantId, 'operations.trips.new-dispatch', {
    environment: 'staging',
  });

  assert.equal(result.source, 'ENVIRONMENT_POLICY');
  assert.equal(result.enabled, false);
  assert.equal(tenantRuleRead, false);
});

test('stale expectedVersion is rejected before update', async () => {
  const query = async (sql) => {
    if (sql.includes('FROM feature_flags.flags')) {
      return { rows: [flagRow()] };
    }
    if (sql.includes('FROM feature_flags.rules')) {
      return { rows: [ruleRow({ target_type: 'TENANT', user_id: null, version: '2' })] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const repository = new PostgresFeatureFlagRepository({ query });
  await assert.rejects(
    repository.putRule(tenantId, 'operations.trips.new-dispatch', {
      environment: null,
      target: { type: 'TENANT' },
      enabled: true,
      rolloutBasisPoints: 5000,
      expectedVersion: 1,
      reason: 'stale test',
    }),
    { code: 'MVT_FEATURE_FLAG_VERSION_CONFLICT' },
  );
});
