import { createServer } from 'node:http';
import { requestHandler } from './http/request-handler.js';
import { createLogger } from './infrastructure/observability/logger.js';
import {
  initializeObservability,
  shutdownObservability,
} from './infrastructure/observability/telemetry.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serverLogger = createLogger('server');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

await initializeObservability();

const server = createServer(requestHandler);
let shuttingDown = false;

server.listen(port, host, () => {
  serverLogger.info('Moventra API listening', {
    event: 'server.started',
    host,
    port,
  });
});

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  serverLogger.info('Shutdown requested', {
    event: 'server.shutdown.requested',
    signal,
  });

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    serverLogger.error('HTTP server shutdown failed', {
      event: 'server.shutdown.http_failed',
      error,
    });
    process.exitCode = 1;
  }

  await shutdownObservability();
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
