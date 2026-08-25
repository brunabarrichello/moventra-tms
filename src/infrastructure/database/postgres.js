import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { createLogger } from '../observability/logger.js';
import { traceDatabaseOperation } from '../observability/tracing.js';

const { Pool } = pg;

const DEFAULT_POOL_MAX = 5;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const SAFE_DATABASE_OPERATIONS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'with',
  'begin',
  'commit',
  'rollback',
  'set',
]);
const databaseLogger = createLogger('postgresql');

let pool;
let attachedToVercel = false;

export function getDatabasePool() {
  if (pool) {
    return pool;
  }

  const connectionString = requireDatabaseUrl();

  pool = new Pool({
    connectionString,
    enableChannelBinding: true,
    max: integerSetting('DB_POOL_MAX', DEFAULT_POOL_MAX, 1, 50),
    idleTimeoutMillis: integerSetting(
      'DB_POOL_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
      1_000,
      300_000,
    ),
    connectionTimeoutMillis: integerSetting(
      'DB_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      1_000,
      60_000,
    ),
    application_name: 'moventra-api',
  });

  if (process.env.VERCEL === '1' && !attachedToVercel) {
    attachDatabasePool(pool);
    attachedToVercel = true;
  }

  pool.on('error', (error) => {
    databaseLogger.error('Unexpected idle PostgreSQL client error', {
      event: 'database.pool.idle_client_error',
      error,
    });
  });

  return pool;
}

export async function queryDatabase(text, values = []) {
  validateQuery(text, values);
  const operation = databaseOperationName(text);
  return traceDatabaseOperation(operation, () => getDatabasePool().query(text, values));
}

export async function withDatabaseTransaction(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Transaction callback must be a function');
  }

  return traceDatabaseOperation('transaction', async () => {
    const client = await getDatabasePool().connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        databaseLogger.error('PostgreSQL rollback failed', {
          event: 'database.transaction.rollback_failed',
          error: rollbackError,
        });
      }
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function checkDatabaseReadiness() {
  const result = await queryDatabase(
    'SELECT current_database() AS database_name, current_setting(\'server_version_num\')::int AS server_version_num',
  );
  const row = result.rows[0];

  return {
    ok: Number(row?.server_version_num) >= 180000,
    databaseName: row?.database_name ?? null,
    serverVersionNum: Number(row?.server_version_num ?? 0),
  };
}

export async function closeDatabasePool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = undefined;
  attachedToVercel = false;
  await activePool.end();
}

export function databaseOperationName(text) {
  if (typeof text !== 'string') {
    return 'query';
  }
  const firstToken = text.trim().match(/^([A-Za-z]+)/)?.[1]?.toLowerCase();
  return SAFE_DATABASE_OPERATIONS.has(firstToken) ? firstToken : 'query';
}

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();

  if (!value) {
    throw databaseConfigurationError(
      'MVT_DB_CONFIG_MISSING',
      'DATABASE_URL is required for PostgreSQL runtime access',
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw databaseConfigurationError('MVT_DB_CONFIG_INVALID', 'DATABASE_URL is not a valid URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw databaseConfigurationError(
      'MVT_DB_CONFIG_INVALID',
      'DATABASE_URL must use postgres or postgresql protocol',
    );
  }

  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw databaseConfigurationError(
      'MVT_DB_CONFIG_INVALID',
      'DATABASE_URL must include host and database name',
    );
  }

  if (!parsed.username || !parsed.password) {
    throw databaseConfigurationError(
      'MVT_DB_CREDENTIAL_MISSING',
      'DATABASE_URL must include application credentials',
    );
  }

  return value;
}

function databaseConfigurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function integerSetting(name, fallback, minimum, maximum) {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}

function validateQuery(text, values) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('SQL query text must be a non-empty string');
  }

  if (!Array.isArray(values)) {
    throw new TypeError('SQL query values must be an array');
  }
}
