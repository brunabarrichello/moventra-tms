import assert from 'node:assert/strict';
import test from 'node:test';

import {
  featureFlagBucketSubject,
  featureFlagRolloutDecision,
  normalizeFeatureFlagExpectedVersion,
  normalizeFeatureFlagKey,
  normalizeFeatureFlagRolloutBasisPoints,
  normalizeFeatureFlagTarget,
  stableFeatureFlagBucket,
} from '../../src/modules/feature-flags/feature-flag-domain.js';

const tenantId = '01990190-0000-7000-8000-000000000001';
const companyId = '01990190-0000-7000-8000-000000000011';
const branchId = '01990190-0000-7000-8000-000000000021';
const userId = '01990190-0000-7000-8000-000000000031';

test('feature flag key is canonical and stable', () => {
  assert.equal(
    normalizeFeatureFlagKey(' Operations.Trips.New-Dispatch '),
    'operations.trips.new-dispatch',
  );
  assert.throws(
    () => normalizeFeatureFlagKey('invalid'),
    { code: 'MVT_FEATURE_FLAG_KEY_INVALID' },
  );
});

test('feature flag target encodes Tenant, Company, Branch, User and trusted Plan shapes', () => {
  assert.deepEqual(normalizeFeatureFlagTarget({ type: 'TENANT' }), {
    type: 'TENANT', companyId: null, branchId: null, userId: null, planKey: null,
  });
  assert.deepEqual(normalizeFeatureFlagTarget({ type: 'COMPANY', companyId }), {
    type: 'COMPANY', companyId, branchId: null, userId: null, planKey: null,
  });
  assert.deepEqual(normalizeFeatureFlagTarget({ type: 'BRANCH', companyId, branchId }), {
    type: 'BRANCH', companyId, branchId, userId: null, planKey: null,
  });
  assert.deepEqual(normalizeFeatureFlagTarget({ type: 'USER', userId }), {
    type: 'USER', companyId: null, branchId: null, userId, planKey: null,
  });
  assert.deepEqual(normalizeFeatureFlagTarget({ type: 'PLAN', planKey: ' Enterprise ' }), {
    type: 'PLAN', companyId: null, branchId: null, userId: null, planKey: 'enterprise',
  });
  assert.throws(
    () => normalizeFeatureFlagTarget({ type: 'BRANCH', branchId }),
    { code: 'MVT_FEATURE_FLAG_TARGET_INVALID' },
  );
});

test('rollout basis points and optimistic version are bounded', () => {
  assert.equal(normalizeFeatureFlagRolloutBasisPoints(0), 0);
  assert.equal(normalizeFeatureFlagRolloutBasisPoints(10000), 10000);
  assert.throws(
    () => normalizeFeatureFlagRolloutBasisPoints(10001),
    { code: 'MVT_FEATURE_FLAG_ROLLOUT_INVALID' },
  );
  assert.equal(normalizeFeatureFlagExpectedVersion(42), '42');
  assert.throws(
    () => normalizeFeatureFlagExpectedVersion(0),
    { code: 'MVT_FEATURE_FLAG_VERSION_INVALID' },
  );
});

test('hash version 1 produces a stable cross-release bucket', () => {
  const bucket = stableFeatureFlagBucket({
    flagKey: 'operations.trips.new-dispatch',
    subject: tenantId,
    hashVersion: 1,
  });
  assert.equal(bucket, 5230);
  assert.equal(
    stableFeatureFlagBucket({
      flagKey: 'operations.trips.new-dispatch',
      subject: tenantId,
      hashVersion: 1,
    }),
    bucket,
  );
  assert.throws(
    () => stableFeatureFlagBucket({
      flagKey: 'operations.trips.new-dispatch',
      subject: tenantId,
      hashVersion: 2,
    }),
    { code: 'MVT_FEATURE_FLAG_HASH_VERSION_UNSUPPORTED' },
  );
});

test('bucket subject prefers authenticated User and rollout boundaries are deterministic', () => {
  assert.equal(featureFlagBucketSubject({ tenantId }), tenantId);
  assert.equal(featureFlagBucketSubject({ tenantId, userId }), userId);
  assert.equal(featureFlagRolloutDecision({ enabled: true, rolloutBasisPoints: 0, bucket: 0 }), false);
  assert.equal(featureFlagRolloutDecision({ enabled: true, rolloutBasisPoints: 10000, bucket: 9999 }), true);
  assert.equal(featureFlagRolloutDecision({ enabled: false, rolloutBasisPoints: 10000, bucket: 0 }), false);
});
