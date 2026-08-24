export const SCOPE_LEVEL = Object.freeze({
  TENANT: 'TENANT',
  COMPANY: 'COMPANY',
  BRANCH: 'BRANCH',
});

const levels = new Set(Object.values(SCOPE_LEVEL));

export function normalizeScopeTarget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw scopeError('MVT_SCOPE_INPUT_INVALID', 'Scope target must be an object');
  }
  const level = String(input.level ?? '').toUpperCase();
  if (!levels.has(level)) {
    throw scopeError('MVT_SCOPE_LEVEL_INVALID', 'Scope level is invalid');
  }
  const companyId = normalizeOptionalUuid(input.companyId, 'Company id');
  const branchId = normalizeOptionalUuid(input.branchId, 'Branch id');
  if (level === SCOPE_LEVEL.TENANT && (companyId || branchId)) {
    throw scopeError('MVT_SCOPE_SHAPE_INVALID', 'Tenant scope cannot contain company or branch');
  }
  if (level === SCOPE_LEVEL.COMPANY && (!companyId || branchId)) {
    throw scopeError('MVT_SCOPE_SHAPE_INVALID', 'Company scope requires only company id');
  }
  if (level === SCOPE_LEVEL.BRANCH && (!companyId || !branchId)) {
    throw scopeError('MVT_SCOPE_SHAPE_INVALID', 'Branch scope requires company and branch ids');
  }
  return { level, companyId, branchId };
}

export function scopeCovers(granted, requested) {
  const grant = normalizeScopeTarget(granted);
  const target = normalizeScopeTarget(requested);
  if (grant.level === SCOPE_LEVEL.TENANT) {
    return true;
  }
  if (grant.level === SCOPE_LEVEL.COMPANY) {
    return grant.companyId === target.companyId;
  }
  return target.level === SCOPE_LEVEL.BRANCH &&
    grant.companyId === target.companyId &&
    grant.branchId === target.branchId;
}

function normalizeOptionalUuid(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw scopeError('MVT_SCOPE_ID_INVALID', `${label} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

function scopeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
