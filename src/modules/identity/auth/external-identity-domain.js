export const EXTERNAL_IDENTITY_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' });
const statuses = new Set(Object.values(EXTERNAL_IDENTITY_STATUS));
const providerPattern = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export function normalizeExternalIdentityCreation(input) {
  assertRecord(input);
  return {
    userId: normalizeUuid(input.userId),
    providerKey: normalizeProviderKey(input.providerKey),
    issuer: normalizeOpaque(input.issuer, 'issuer'),
    subject: normalizeOpaque(input.subject, 'subject'),
    status: EXTERNAL_IDENTITY_STATUS.ACTIVE,
  };
}
export function normalizeProviderKey(value) {
  const v = requireString(value, 'provider key').toLowerCase();
  if (!providerPattern.test(v)) throw authError('MVT_AUTH_PROVIDER_INVALID', 'Provider key is invalid');
  return v;
}
export function normalizeIssuer(value) { return normalizeOpaque(value, 'issuer'); }
export function normalizeSubject(value) { return normalizeOpaque(value, 'subject'); }
export function assertExternalIdentityStatus(value) {
  if (!statuses.has(value)) throw authError('MVT_AUTH_IDENTITY_STATUS_INVALID', `Unknown identity status: ${value}`);
  return value;
}
export function assertExternalIdentityTransition(from, to) {
  assertExternalIdentityStatus(from); assertExternalIdentityStatus(to);
  const allowed = from === 'ACTIVE' ? to === 'DISABLED' : to === 'ACTIVE';
  if (!allowed) throw authError('MVT_AUTH_IDENTITY_TRANSITION_INVALID', `External identity transition ${from} -> ${to} is not allowed`);
}
export function normalizeAuthExpectedVersion(value) {
  const v = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(v)) throw authError('MVT_AUTH_VERSION_INVALID', 'Expected version must be positive');
  return v;
}
export function normalizeUuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw authError('MVT_AUTH_ID_INVALID', 'Identifier must be a canonical UUID');
  }
  return value.toLowerCase();
}
function normalizeOpaque(value, label) {
  const v = requireString(value, label);
  if (v.length > 500) throw authError('MVT_AUTH_ASSERTION_INVALID', `${label} is too long`);
  return v;
}
function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw authError('MVT_AUTH_ASSERTION_INVALID', `${label} is required`);
  return value.trim();
}
function assertRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw authError('MVT_AUTH_ASSERTION_INVALID', 'Input must be an object');
}
function authError(code, message) { const e = new Error(message); e.code = code; return e; }
