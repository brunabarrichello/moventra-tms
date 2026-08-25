import { getHealthSnapshot } from '../src/core/health.js';
import { observeHttpRequest } from '../src/infrastructure/observability/http.js';

export default async function handler(request, response) {
  return observeHttpRequest({
    request,
    response,
    route: '/health',
    handler: async () => {
      response.setHeader('cache-control', 'no-store');
      const version = process.env.APP_VERSION?.trim()
        || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
        || undefined;
      response.status(200).json(getHealthSnapshot(version));
    },
  });
}
