import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRabbitMqDlqConfig } from '../../src/infrastructure/dlq/rabbitmq-dlq-config.js';

test('DLQ config uses bounded provider-specific defaults', () => {
  const config = resolveRabbitMqDlqConfig({});
  assert.equal(config.deadLetterExchange, 'moventra.dlx');
  assert.equal(config.queue, 'moventra.dlq.ingest');
  assert.equal(config.prefetch, 10);
  assert.equal(config.persistenceRetries, 5);

  assert.throws(
    () => resolveRabbitMqDlqConfig({ DLQ_RABBITMQ_PREFETCH: '0' }),
    { code: 'MVT_DLQ_CONFIG_INVALID' },
  );
});
