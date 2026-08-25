import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLogger,
  redactSensitiveText,
  sanitizeLogMetadata,
} from '../../src/infrastructure/observability/logger.js';
import { runWithRequestContext } from '../../src/infrastructure/observability/request-context.js';

function captureSink() {
  const records = [];
  const write = (line) => records.push(JSON.parse(line));
  return {
    records,
    sink: { debug: write, log: write, warn: write, error: write },
  };
}

function databaseUrl(user, password, host, path = 'db') {
  return ['postgresql', '://', user, ':', password, '@', host, '/', path].join('');
}

test('structured logger redacts common secret material and connection strings', () => {
  const safe = sanitizeLogMetadata({
    authorization: 'Bearer secret-token',
    cookie: 'session=secret',
    databaseUrl: databaseUrl('user', 'password', 'example.test'),
    nested: {
      token: 'abc',
      note: `Bearer xyz password=hunter2 ${databaseUrl('u', 'p', 'db.test', 'x')}`,
    },
  });

  assert.equal(safe.authorization, '[REDACTED]');
  assert.equal(safe.cookie, '[REDACTED]');
  assert.equal(safe.databaseUrl, '[REDACTED]');
  assert.equal(safe.nested.token, '[REDACTED]');
  assert.doesNotMatch(safe.nested.note, /hunter2|u:p|Bearer xyz/);
  assert.match(safe.nested.note, /REDACTED/);
  assert.doesNotMatch(redactSensitiveText(databaseUrl('a', 'b', 'host')), /a:b/);
});

test('structured logger attaches request correlation context without serializing arbitrary depth', () => {
  const { records, sink } = captureSink();
  const logger = createLogger('test-component', { sink });
  const circular = { level: 1 };
  circular.self = circular;

  runWithRequestContext({ requestId: 'req-log-020', correlationId: 'corr-log-020' }, () => {
    logger.info('completed', {
      event: 'test.completed',
      circular,
      password: 'must-not-appear',
    });
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].component, 'test-component');
  assert.equal(records[0].requestId, 'req-log-020');
  assert.equal(records[0].correlationId, 'corr-log-020');
  assert.equal(records[0].password, '[REDACTED]');
  assert.equal(records[0].circular.self.self, '[TRUNCATED]');
  assert.doesNotMatch(JSON.stringify(records[0]), /must-not-appear/);
});
