import { withDatabaseTransaction } from './postgres.js';

export async function withTenantDatabaseTransaction(tenantId, callback) {
  const tenant = normalizeTenantId(tenantId);
  if (typeof callback !== 'function') {
    throw new TypeError('Tenant transaction callback must be a function');
  }

  return withDatabaseTransaction(async (client) => {
    await client.query(
      "SELECT set_config('moventra.tenant_id', $1, true) AS tenant_id",
      [tenant],
    );
    return callback(client, tenant);
  });
}

export function normalizeTenantId(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    const error = new Error('Tenant context must be a canonical UUID');
    error.code = 'MVT_TENANT_CONTEXT_INVALID';
    throw error;
  }
  return value.toLowerCase();
}
