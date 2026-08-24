const permissionPattern = /^[a-z][a-z0-9_.]{2,127}$/;
const roleCodePattern = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export function normalizePermission(input) {
  assertRecord(input, 'Permission');
  const code = requireString(input.code, 'Permission code').toLowerCase();
  if (!permissionPattern.test(code)) {
    throw rbacError('MVT_RBAC_PERMISSION_CODE_INVALID', 'Permission code is invalid');
  }
  const description = requireString(input.description, 'Permission description');
  if (description.length > 500) {
    throw rbacError('MVT_RBAC_PERMISSION_DESCRIPTION_INVALID', 'Permission description is too long');
  }
  return { code, description, status: 'ACTIVE' };
}

export function normalizeRole(input) {
  assertRecord(input, 'Role');
  const code = requireString(input.code, 'Role code').toLowerCase();
  if (!roleCodePattern.test(code)) {
    throw rbacError('MVT_RBAC_ROLE_CODE_INVALID', 'Role code is invalid');
  }
  const name = requireString(input.name, 'Role name');
  if (name.length > 160) {
    throw rbacError('MVT_RBAC_ROLE_NAME_INVALID', 'Role name is too long');
  }
  const description = normalizeOptionalDescription(input.description);
  return { code, name, description, status: 'ACTIVE' };
}

export function normalizeRbacExpectedVersion(value) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw rbacError('MVT_RBAC_VERSION_INVALID', 'Expected version must be positive');
  }
  return normalized;
}

export function normalizeUuid(value, label = 'Identifier') {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw rbacError('MVT_RBAC_ID_INVALID', `${label} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

export function normalizePermissionCode(value) {
  const code = requireString(value, 'Permission code').toLowerCase();
  if (!permissionPattern.test(code)) {
    throw rbacError('MVT_RBAC_PERMISSION_CODE_INVALID', 'Permission code is invalid');
  }
  return code;
}

function normalizeOptionalDescription(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const description = requireString(value, 'Role description');
  if (description.length > 500) {
    throw rbacError('MVT_RBAC_ROLE_DESCRIPTION_INVALID', 'Role description is too long');
  }
  return description;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw rbacError('MVT_RBAC_INPUT_INVALID', `${label} is required`);
  }
  return value.trim();
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw rbacError('MVT_RBAC_INPUT_INVALID', `${label} input must be an object`);
  }
}

function rbacError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
