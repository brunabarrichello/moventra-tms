import { createHash } from 'node:crypto';

export const FEATURE_FLAG_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

export const FEATURE_FLAG_TARGET = Object.freeze({
  TENANT: 'TENANT',
  COMPANY: 'COMPANY',
  BRANCH: 'BRANCH',
  USER: 'USER',
  PLAN: 'PLAN',
});

export const FEATURE_FLAG_ENVIRONMENT = Object.freeze({
  DEVELOPMENT: 'development',
  PREVIEW: 'preview',
  STAGING: 'staging',
  PRODUCTION: 'production',
});

export const FEATURE_FLAG_HASH_VERSION = Object.freeze({
  SHA256_FIRST_64_MOD_10000: 1,
});

const targetTypes = new Set(Object.values(FEATURE_FLAG_TARGET));
const environments = new Set(Object.values(FEATURE_FLAG_ENVIRONMENT));

export function normalizeFeatureFlagKey(value) {
  if (typeof value !== 'string') {
    throw featureFlagError('MVT_FEATURE_FLAG_KEY_INVALID', 'Feature flag key must be text');
  }
  const key = value.trim().toLowerCase();
  if (
    key.length < 3 ||
    key.length > 160 ||
    !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*){1,7}$/.test(key)
  ) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_KEY_INVALID',
      'Feature flag key must be canonical lowercase dot-separated text',
    );
  }
  return key;
}

export function normalizeFeatureFlagEnvironment(value) {
  if (typeof value !== 'string') {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_ENVIRONMENT_INVALID',
      'Trusted runtime environment must be text',
    );
  }
  const environment = value.trim().toLowerCase();
  if (!environments.has(environment)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_ENVIRONMENT_INVALID',
      'Trusted runtime environment is unsupported',
    );
  }
  return environment;
}

export function normalizeOptionalRuleEnvironment(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeFeatureFlagEnvironment(value);
}

export function normalizeFeatureFlagTarget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw featureFlagError('MVT_FEATURE_FLAG_TARGET_INVALID', 'Feature flag target must be an object');
  }

  const type = String(input.type ?? '').trim().toUpperCase();
  if (!targetTypes.has(type)) {
    throw featureFlagError('MVT_FEATURE_FLAG_TARGET_INVALID', 'Feature flag target type is invalid');
  }

  const companyId = normalizeOptionalUuid(input.companyId, 'companyId');
  const branchId = normalizeOptionalUuid(input.branchId, 'branchId');
  const userId = normalizeOptionalUuid(input.userId, 'userId');
  const planKey = normalizeOptionalPlanKey(input.planKey);

  if (type === FEATURE_FLAG_TARGET.TENANT && (companyId || branchId || userId || planKey)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_TARGET_INVALID',
      'Tenant target cannot include Company, Branch, User or Plan',
    );
  }
  if (type === FEATURE_FLAG_TARGET.COMPANY && (!companyId || branchId || userId || planKey)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_TARGET_INVALID',
      'Company target requires companyId only',
    );
  }
  if (type === FEATURE_FLAG_TARGET.BRANCH && (!companyId || !branchId || userId || planKey)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_TARGET_INVALID',
      'Branch target requires companyId and branchId only',
    );
  }
  if (type === FEATURE_FLAG_TARGET.USER && (!userId || companyId || branchId || planKey)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_TARGET_INVALID',
      'User target requires userId only',
    );
  }
  if (type === FEATURE_FLAG_TARGET.PLAN && (!planKey || companyId || branchId || userId)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_TARGET_INVALID',
      'Plan target requires trusted planKey only',
    );
  }

  return Object.freeze({ type, companyId, branchId, userId, planKey });
}

export function normalizeFeatureFlagRolloutBasisPoints(value = 10000) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_ROLLOUT_INVALID',
      'Feature flag rollout must be an integer between 0 and 10000 basis points',
    );
  }
  return value;
}

export function normalizeFeatureFlagExpectedVersion(value) {
  const normalized = typeof value === 'number' ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]{0,18}$/.test(normalized)) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_VERSION_INVALID',
      'Expected version must be a positive integer',
    );
  }
  return normalized;
}

export function normalizeFeatureFlagReason(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw featureFlagError('MVT_FEATURE_FLAG_REASON_INVALID', 'Change reason must be text');
  }
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_REASON_INVALID',
      'Change reason must contain between 2 and 500 characters',
    );
  }
  return reason;
}

export function stableFeatureFlagBucket({ flagKey, subject, hashVersion = 1 }) {
  const key = normalizeFeatureFlagKey(flagKey);
  if (typeof subject !== 'string' || !subject.trim()) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_BUCKET_SUBJECT_INVALID',
      'Feature flag bucket subject is required',
    );
  }
  if (hashVersion !== FEATURE_FLAG_HASH_VERSION.SHA256_FIRST_64_MOD_10000) {
    throw featureFlagError(
      'MVT_FEATURE_FLAG_HASH_VERSION_UNSUPPORTED',
      'Feature flag hash version is unsupported by this runtime',
    );
  }

  const digest = createHash('sha256')
    .update(`${key}:${subject.trim().toLowerCase()}`, 'utf8')
    .digest();
  const first64 = digest.readBigUInt64BE(0);
  return Number(first64 % 10000n);
}

export function featureFlagRolloutDecision({ enabled, rolloutBasisPoints, bucket }) {
  if (typeof enabled !== 'boolean') {
    throw featureFlagError('MVT_FEATURE_FLAG_ENABLED_INVALID', 'Feature flag enabled value must be boolean');
  }
  const rollout = normalizeFeatureFlagRolloutBasisPoints(rolloutBasisPoints);
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > 9999) {
    throw featureFlagError('MVT_FEATURE_FLAG_BUCKET_INVALID', 'Feature flag bucket must be between 0 and 9999');
  }
  return enabled && bucket < rollout;
}

export function featureFlagBucketSubject({ tenantId, userId = null }) {
  const tenant = normalizeUuid(tenantId, 'TENANT');
  const user = normalizeOptionalUuid(userId, 'userId');
  return user ?? tenant;
}

export function normalizeFeatureFlagTenantId(value) {
  return normalizeUuid(value, 'TENANT');
}

export function normalizeFeatureFlagRuleId(value) {
  return normalizeUuid(value, 'RULE');
}

export function normalizeFeatureFlagUserId(value) {
  return normalizeUuid(value, 'USER');
}

function normalizeOptionalPlanKey(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw featureFlagError('MVT_FEATURE_FLAG_PLAN_INVALID', 'Trusted plan key must be text');
  }
  const planKey = value.trim().toLowerCase();
  if (planKey.length < 2 || planKey.length > 63 || !/^[a-z][a-z0-9_-]*$/.test(planKey)) {
    throw featureFlagError('MVT_FEATURE_FLAG_PLAN_INVALID', 'Trusted plan key is invalid');
  }
  return planKey;
}

function normalizeOptionalUuid(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeUuid(value, label);
}

function normalizeUuid(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw featureFlagError(
      `MVT_FEATURE_FLAG_${label}_INVALID`,
      `${label} must be a canonical UUID`,
    );
  }
  return value.toLowerCase();
}

function featureFlagError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
