import { getHealthSnapshot } from '../src/core/health.js';

export default function handler(_request, response) {
  response.setHeader('cache-control', 'no-store');
  const version = process.env.APP_VERSION?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined;
  response.status(200).json(getHealthSnapshot(version));
}
