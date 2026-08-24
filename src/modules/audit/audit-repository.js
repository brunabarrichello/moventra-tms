import { queryDatabase } from '../../infrastructure/database/postgres.js';
import { normalizeAuditEvent } from './audit-domain.js';

export class PostgresAuditRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('Audit repository query dependency must be a function');
    }
    this.query = query;
  }

  async append(input) {
    const event = normalizeAuditEvent(input);
    const result = await this.query(
      `INSERT INTO audit.audit_events (
         tenant_id, actor_user_id, actor_membership_id, company_id, branch_id,
         category, action, entity_type, entity_id, outcome,
         request_id, correlation_id, reason, before_data, after_data, metadata
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb
       )
       RETURNING id, occurred_at`,
      [
        event.tenantId,
        event.actorUserId,
        event.actorMembershipId,
        event.companyId,
        event.branchId,
        event.category,
        event.action,
        event.entityType,
        event.entityId,
        event.outcome,
        event.requestId,
        event.correlationId,
        event.reason,
        JSON.stringify(event.beforeData),
        JSON.stringify(event.afterData),
        JSON.stringify(event.metadata),
      ],
    );
    if (!result.rows[0]) {
      throw auditRepositoryError('MVT_AUDIT_WRITE_FAILED', 'Audit event was not persisted');
    }
    return Object.freeze({ id: result.rows[0].id, occurredAt: result.rows[0].occurred_at });
  }
}

function auditRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
