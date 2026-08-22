import { getHealthSnapshot } from '../src/core/health.js';

export default function handler(_request, response) {
  response.setHeader('cache-control', 'no-store');
  const version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_VERSION;
  response.status(200).json(getHealthSnapshot(version));
}
