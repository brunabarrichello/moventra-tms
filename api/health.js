import { getHealthSnapshot } from '../src/core/health.js';
import { MethodNotAllowedError } from '../src/core/errors/app-error.js';
import { handleHttpError } from '../src/http/error-mapper.js';
import { observeHttpRequest } from '../src/infrastructure/observability/http.js';

export default async function handler(request, response) {
  return observeHttpRequest({
    request,
    response,
    route: '/health',
    handler: async () => {
      response.setHeader('cache-control', 'no-store');

      if ((request.method ?? 'GET') !== 'GET') {
        handleHttpError({
          error: new MethodNotAllowedError({ message: 'Only GET is supported by the health endpoint' }),
          request,
          response,
          instance: '/health',
          allow: 'GET',
        });
        return;
      }

      const version = process.env.APP_VERSION?.trim()
        || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
        || undefined;
      response.status(200).json(getHealthSnapshot(version));
    },
  });
}
