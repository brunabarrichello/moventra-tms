export function getDatabaseHealthSnapshot(readiness, version = process.env.APP_VERSION ?? 'development') {
  const normalizedVersion = typeof version === 'string' && version.trim() ? version.trim() : 'development';
  const ready = readiness?.ok === true;

  return Object.freeze({
    status: ready ? 'ready' : 'unavailable',
    service: 'database',
    version: normalizedVersion,
  });
}
