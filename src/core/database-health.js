const SAFE_REASONS = new Set([
  'configuration_missing',
  'configuration_invalid',
  'authentication_failed',
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
  switch (error?.code) {
    case 'MVT_DB_CONFIG_MISSING':
      return 'configuration_missing';
    case 'MVT_DB_CONFIG_INVALID':
      return 'configuration_invalid';
    case '28P01':
      return 'authentication_failed';
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
    case '08001':
    case '08006':
      return 'connection_failed';
    default:
      return 'unavailable';
  }
}
