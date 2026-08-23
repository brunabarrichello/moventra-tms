const SAFE_REASONS = new Set([
  'configuration_missing',
  'configuration_invalid',
  'credentials_missing',
  'authentication_failed',
  'tls_failed',
  'connection_failed',
  'unavailable',
]);

export function getDatabaseHealthSnapshot(
  readiness,
  version = process.env.APP_VERSION ?? 'development',
  reason,
) {
  const normalizedVersion = typeof version === 'string' && version.trim() ? version.trim() : 'development';
  const ready = readiness?.ok === true;
  const snapshot = {
    status: ready ? 'ready' : 'unavailable',
    service: 'database',
    version: normalizedVersion,
  };

  if (!ready && SAFE_REASONS.has(reason)) {
    snapshot.reason = reason;
  }

  return Object.freeze(snapshot);
}

export function classifyDatabaseHealthError(error) {
  const code = error?.code ?? error?.cause?.code;

  switch (code) {
    case 'MVT_DB_CONFIG_MISSING':
      return 'configuration_missing';
    case 'MVT_DB_CONFIG_INVALID':
      return 'configuration_invalid';
    case 'MVT_DB_CREDENTIAL_MISSING':
      return 'credentials_missing';
    case '28P01':
      return 'authentication_failed';
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
    case 'EAI_AGAIN':
    case '08001':
    case '08006':
      return 'connection_failed';
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'tls_failed';
    default:
      return classifyDatabaseHealthMessage(error?.message);
  }
}

function classifyDatabaseHealthMessage(message) {
  if (typeof message !== 'string') {
    return 'unavailable';
  }

  const normalized = message.toLowerCase();

  if (
    normalized.includes('client password must be a string') ||
    normalized.includes('client password must be a non-empty string')
  ) {
    return 'credentials_missing';
  }

  if (normalized.includes('password authentication failed')) {
    return 'authentication_failed';
  }

  if (
    normalized.includes('channel binding') ||
    normalized.includes('scram-sha-256-plus requires a certificate') ||
    normalized.includes('certificate') ||
    normalized.includes('tls') ||
    normalized.includes('ssl')
  ) {
    return 'tls_failed';
  }

  if (
    normalized.includes('connection terminated unexpectedly') ||
    normalized.includes('timeout expired') ||
    normalized.includes('getaddrinfo')
  ) {
    return 'connection_failed';
  }

  return 'unavailable';
}
