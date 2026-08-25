import {
  classifyDatabaseHealthError,
  getDatabaseHealthSnapshot,
} from '../src/core/database-health.js';
import { MethodNotAllowedError } from '../src/core/errors/app-error.js';
import { handleHttpError } from '../src/http/error-mapper.js';
import { checkDatabaseReadiness } from '../src/infrastructure/database/postgres.js';
import { observeHttpRequest } from '../src/infrastructure/observability/http.js';
import { createLogger } from '../src/infrastructure/observability/logger.js';

const databaseHealthLogger = createLogger('database-health');

export default async function handler(request, response) {
  return observeHttpRequest({
    request,
    response,
    route: '/api/database-health',
    handler: async () => {
      response.setHeader('cache-control', 'no-store');

      if ((request.method ?? 'GET') !== 'GET') {
        handleHttpError({
          error: new MethodNotAllowedError({ message: 'Only GET is supported by database readiness' }),
          request,
          response,
          instance: '/api/database-health',
          allow: 'GET',
        });
        return;
      }

      const version = process.env.APP_VERSION?.trim()
        || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
        || undefined;

      try {
        const readiness = await checkDatabaseReadiness();
        const snapshot = getDatabaseHealthSnapshot(readiness, version);
        response.status(snapshot.status === 'ready' ? 200 : 503).json(snapshot);
      } catch (error) {
        const reason = classifyDatabaseHealthError(error);

        databaseHealthLogger.warn('Database readiness probe failed', {
          event: 'database.readiness.failed',
          reason,
          error,
        });

        response.status(503).json(getDatabaseHealthSnapshot({ ok: false }, version, reason));
      }
    },
  });
}
