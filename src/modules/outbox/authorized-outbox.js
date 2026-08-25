import { normalizeTenantId } from '../../infrastructure/database/tenant-context.js';
import { PostgresOutboxRepository } from './outbox-repository.js';
import { OutboxService } from './outbox-service.js';

export function createAuthorizedOutbox(operationContext, { serviceFactory = createOutboxService } = {}) {
  if (!operationContext || typeof operationContext !== 'object') {
    throw new TypeError('Authorized outbox requires an operation context');
  }
  if (typeof operationContext.query !== 'function') {
    throw new TypeError('Authorized outbox requires the shared PostgreSQL transaction query');
  }
  if (typeof serviceFactory !== 'function') {
    throw new TypeError('Authorized outbox serviceFactory must be a function');
  }

  const tenantId = normalizeTenantId(operationContext.tenantId);
  const service = serviceFactory(operationContext.query);
  if (!service || typeof service.append !== 'function') {
    throw new TypeError('Authorized outbox service is incomplete');
  }

  return Object.freeze({
    append: (input) => service.append({ ...input, tenantId }),
  });
}

export function createOutboxService(query) {
  return new OutboxService({
    repository: new PostgresOutboxRepository({ query }),
  });
}
