export const CONFIGURATION_VALUE_TYPE = Object.freeze({
  BOOLEAN: 'BOOLEAN',
  INTEGER: 'INTEGER',
  DECIMAL: 'DECIMAL',
  STRING: 'STRING',
  ENUM: 'ENUM',
  JSON: 'JSON',
  DURATION: 'DURATION',
  TIMEZONE: 'TIMEZONE',
  CURRENCY: 'CURRENCY',
});

export const CONFIGURATION_SCOPE = Object.freeze({
  TENANT: 'TENANT',
  COMPANY: 'COMPANY',
  BRANCH: 'BRANCH',
});

export const CONFIGURATION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

export const CONFIGURATION_SENSITIVITY = Object.freeze({
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL',
  CONFIDENTIAL: 'CONFIDENTIAL',
});

const valueTypes = new Set(Object.values(CONFIGURATION_VALUE_TYPE));
const scopeTypes = new Set(Object.values(CONFIGURATION_SCOPE));
const sensitivities = new Set(Object.values(CONFIGURATION_SENSITIVITY));
const secretKeyFragments = [
  'password',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'private_key',
  'database_url',
  'credentials',
  'secret_value',
];

export function normalizeConfigurationKey(value) {
  if (typeof value !== 'string') {
    throw configurationError('MVT_CONFIGURATION_KEY_INVALID', 'Configuration key must be a string');
  }
  const key = value.trim().toLowerCase();
  if (
    key.length < 3 ||
    key.length > 160 ||
    !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,7}$/.test(key)
  ) {
    throw configurationError(
      'MVT_CONFIGURATION_KEY_INVALID',
      'Configuration key must be canonical lowercase dot-separated text',
    );
  }
  if (secretKeyFragments.some((fragment) => key.includes(fragment))) {
    throw configurationError(
      'MVT_CONFIGURATION_SECRET_FORBIDDEN',
      'Secret-bearing configuration keys belong to Secrets Management',
    );
  }
  return key;
}

export function normalizeConfigurationScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw configurationError('MVT_CONFIGURATION_SCOPE_INVALID', 'Configuration scope must be an object');
  }
  const type = String(input.type ?? '').trim().toUpperCase();
  if (!scopeTypes.has(type)) {
    throw configurationError('MVT_CONFIGURATION_SCOPE_INVALID', 'Configuration scope type is invalid');
  }
  const companyId = normalizeOptionalUuid(input.companyId, 'companyId');
  const branchId = normalizeOptionalUuid(input.branchId, 'branchId');

  if (type === CONFIGURATION_SCOPE.TENANT && (companyId || branchId)) {
    throw configurationError(
      'MVT_CONFIGURATION_SCOPE_INVALID',
      'Tenant scope cannot include Company or Branch',
    );
  }
  if (type === CONFIGURATION_SCOPE.COMPANY && (!companyId || branchId)) {
    throw configurationError(
      'MVT_CONFIGURATION_SCOPE_INVALID',
      'Company scope requires companyId and no branchId',
    );
  }
  if (type === CONFIGURATION_SCOPE.BRANCH && (!companyId || !branchId)) {
    throw configurationError(
      'MVT_CONFIGURATION_SCOPE_INVALID',
      'Branch scope requires companyId and branchId',
    );
  }
  return Object.freeze({ type, companyId, branchId });
}

export function scopeFromConfigurationContext({ companyId = null, branchId = null } = {}) {
  if (branchId) {
    return normalizeConfigurationScope({ type: 'BRANCH', companyId, branchId });
  }
  if (companyId) {
    return normalizeConfigurationScope({ type: 'COMPANY', companyId });
  }
  return normalizeConfigurationScope({ type: 'TENANT' });
}

export function assertConfigurationScopeAllowed(definition, scope) {
  const normalized = normalizeConfigurationScope(scope);
  const allowed = {
    TENANT: definition?.allowTenantOverride === true,
    COMPANY: definition?.allowCompanyOverride === true,
    BRANCH: definition?.allowBranchOverride === true,
  };
  if (!allowed[normalized.type]) {
    throw configurationError(
      'MVT_CONFIGURATION_SCOPE_NOT_ALLOWED',
      `Configuration definition does not allow ${normalized.type} override`,
    );
  }
  return normalized;
}

export function normalizeConfigurationValue(definition, value) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw configurationError(
      'MVT_CONFIGURATION_DEFINITION_INVALID',
      'Configuration definition is required to validate a value',
    );
  }
  const valueType = String(definition.valueType ?? '').toUpperCase();
  if (!valueTypes.has(valueType)) {
    throw configurationError('MVT_CONFIGURATION_TYPE_INVALID', 'Configuration value type is invalid');
  }
  const sensitivity = String(definition.sensitivity ?? 'INTERNAL').toUpperCase();
  if (!sensitivities.has(sensitivity)) {
    throw configurationError(
      'MVT_CONFIGURATION_SENSITIVITY_INVALID',
      'Configuration sensitivity is invalid',
    );
  }
  if (value === null || value === undefined) {
    throw configurationError('MVT_CONFIGURATION_VALUE_INVALID', 'Configuration value cannot be null');
  }
  const schema = normalizeValidationSchema(definition.validationSchema);

  switch (valueType) {
    case CONFIGURATION_VALUE_TYPE.BOOLEAN:
      if (typeof value !== 'boolean') {
        throw invalidValue('BOOLEAN value must be true or false');
      }
      return value;
    case CONFIGURATION_VALUE_TYPE.INTEGER:
      return normalizeInteger(value, schema);
    case CONFIGURATION_VALUE_TYPE.DECIMAL:
      return normalizeDecimal(value, schema);
    case CONFIGURATION_VALUE_TYPE.STRING:
      return normalizeString(value, schema);
    case CONFIGURATION_VALUE_TYPE.ENUM:
      return normalizeEnum(value, schema);
    case CONFIGURATION_VALUE_TYPE.JSON:
      return normalizeJson(value, schema);
    case CONFIGURATION_VALUE_TYPE.DURATION:
      return normalizeDuration(value, schema);
    case CONFIGURATION_VALUE_TYPE.TIMEZONE:
      return normalizeTimezone(value);
    case CONFIGURATION_VALUE_TYPE.CURRENCY:
      return normalizeCurrency(value);
    default:
      throw configurationError('MVT_CONFIGURATION_TYPE_INVALID', 'Unsupported configuration value type');
  }
}

export function normalizeConfigurationExpectedVersion(value) {
  const normalized = typeof value === 'number' ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]{0,18}$/.test(normalized)) {
    throw configurationError(
      'MVT_CONFIGURATION_VERSION_INVALID',
      'Expected version must be a positive integer',
    );
  }
  return normalized;
}

export function normalizeConfigurationReason(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw configurationError('MVT_CONFIGURATION_REASON_INVALID', 'Change reason must be text');
  }
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw configurationError(
      'MVT_CONFIGURATION_REASON_INVALID',
      'Change reason must contain between 2 and 500 characters',
    );
  }
  return reason;
}

export function configurationAuditValue(definition, value) {
  if (definition?.sensitivity === CONFIGURATION_SENSITIVITY.CONFIDENTIAL) {
    return Object.freeze({ redacted: true });
  }
  return value;
}

function normalizeValidationSchema(value) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw configurationError(
      'MVT_CONFIGURATION_SCHEMA_INVALID',
      'Configuration validation schema must be an object',
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > 16 * 1024) {
    throw configurationError(
      'MVT_CONFIGURATION_SCHEMA_INVALID',
      'Configuration validation schema exceeds 16 KiB',
    );
  }
  return value;
}

function normalizeInteger(value, schema) {
  if (!Number.isSafeInteger(value)) {
    throw invalidValue('INTEGER value must be a safe integer');
  }
  assertNumericBounds(value, schema);
  return value;
}

function normalizeDecimal(value, schema) {
  if (typeof value !== 'string') {
    throw invalidValue('DECIMAL value must use an exact decimal string representation');
  }
  const decimal = value.trim();
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(decimal) || decimal.length > 80) {
    throw invalidValue('DECIMAL value is not a canonical decimal string');
  }
  const comparable = Number(decimal);
  if (!Number.isFinite(comparable)) {
    throw invalidValue('DECIMAL value is outside supported validation range');
  }
  assertNumericBounds(comparable, schema);
  return decimal;
}

function normalizeString(value, schema) {
  if (typeof value !== 'string') {
    throw invalidValue('STRING value must be text');
  }
  const minLength = optionalSafeInteger(schema.minLength, 0, 100000, 'minLength');
  const maxLength = optionalSafeInteger(schema.maxLength, 0, 100000, 'maxLength');
  if (minLength !== null && value.length < minLength) {
    throw invalidValue('STRING value is shorter than minLength');
  }
  if (maxLength !== null && value.length > maxLength) {
    throw invalidValue('STRING value exceeds maxLength');
  }
  if (typeof schema.pattern === 'string') {
    let pattern;
    try {
      pattern = new RegExp(schema.pattern, 'u');
    } catch {
      throw configurationError('MVT_CONFIGURATION_SCHEMA_INVALID', 'STRING pattern is invalid');
    }
    if (!pattern.test(value)) {
      throw invalidValue('STRING value does not match configured pattern');
    }
  }
  return value;
}

function normalizeEnum(value, schema) {
  if (typeof value !== 'string') {
    throw invalidValue('ENUM value must be text');
  }
  if (
    !Array.isArray(schema.allowedValues) ||
    schema.allowedValues.length < 1 ||
    schema.allowedValues.length > 200 ||
    schema.allowedValues.some((item) => typeof item !== 'string' || !item.length)
  ) {
    throw configurationError(
      'MVT_CONFIGURATION_SCHEMA_INVALID',
      'ENUM validation requires non-empty allowedValues',
    );
  }
  if (!schema.allowedValues.includes(value)) {
    throw invalidValue('ENUM value is not in allowedValues');
  }
  return value;
}

function normalizeJson(value, schema) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidValue('JSON value must be serializable');
  }
  if (serialized === undefined) {
    throw invalidValue('JSON value must be serializable');
  }
  const maxBytes = optionalSafeInteger(schema.maxBytes, 1, 1024 * 1024, 'maxBytes') ?? 64 * 1024;
  const maxDepth = optionalSafeInteger(schema.maxDepth, 1, 32, 'maxDepth') ?? 8;
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw invalidValue('JSON value exceeds maxBytes');
  }
  if (jsonDepth(value) > maxDepth) {
    throw invalidValue('JSON value exceeds maxDepth');
  }
  return JSON.parse(serialized);
}

function normalizeDuration(value, schema) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidValue('DURATION is stored as a non-negative integer number of seconds');
  }
  assertNumericBounds(value, schema);
  return value;
}

function normalizeTimezone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw invalidValue('TIMEZONE value must be an IANA timezone name');
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw invalidValue('TIMEZONE value is not recognized by the runtime');
  }
}

function normalizeCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw invalidValue('CURRENCY value must be an ISO 4217 alpha-3 code');
  }
  const currency = value.trim().toUpperCase();
  if (typeof Intl.supportedValuesOf === 'function') {
    const supported = Intl.supportedValuesOf('currency');
    if (!supported.includes(currency)) {
      throw invalidValue('CURRENCY value is not recognized by the runtime');
    }
  }
  return currency;
}

function assertNumericBounds(value, schema) {
  if (schema.minimum !== undefined) {
    if (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum)) {
      throw configurationError('MVT_CONFIGURATION_SCHEMA_INVALID', 'minimum must be finite');
    }
    if (value < schema.minimum) {
      throw invalidValue('Configuration value is below minimum');
    }
  }
  if (schema.maximum !== undefined) {
    if (typeof schema.maximum !== 'number' || !Number.isFinite(schema.maximum)) {
      throw configurationError('MVT_CONFIGURATION_SCHEMA_INVALID', 'maximum must be finite');
    }
    if (value > schema.maximum) {
      throw invalidValue('Configuration value exceeds maximum');
    }
  }
}

function optionalSafeInteger(value, minimum, maximum, name) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configurationError(
      'MVT_CONFIGURATION_SCHEMA_INVALID',
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function jsonDepth(value) {
  if (value === null || typeof value !== 'object') {
    return 1;
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  if (children.length === 0) {
    return 1;
  }
  return 1 + Math.max(...children.map(jsonDepth));
}

function normalizeOptionalUuid(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw configurationError(
      'MVT_CONFIGURATION_SCOPE_INVALID',
      `${label} must be a canonical UUID`,
    );
  }
  return value.toLowerCase();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidValue(message) {
  return configurationError('MVT_CONFIGURATION_VALUE_INVALID', message);
}

function configurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
