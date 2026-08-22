import { getDatabaseHealthSnapshot } from '../src/core/database-health.js';
import { checkDatabaseReadiness } from '../src/infrastructure/database/postgres.js';

export default async function handler(request, response) {
  response.setHeader('cache-control', 'no-store');

  if ((request.method ?? 'GET') !== 'GET') {
    response.setHeader('allow', 'GET');
    response.status(405).json({
      status: 'error',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const version = process.env.APP_VERSION?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined;

  try {
    const readiness = await checkDatabaseReadiness();
    const snapshot = getDatabaseHealthSnapshot(readiness, version);
    response.status(snapshot.status === 'ready' ? 200 : 503).json(snapshot);
  } catch (error) {
    console.error('Database readiness probe failed', {
      name: error?.name,
      code: error?.code,
    });

    response.status(503).json(getDatabaseHealthSnapshot({ ok: false }, version));
  }
}
