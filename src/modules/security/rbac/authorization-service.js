export class AuthorizationService {
  constructor({ rbac }) {
    if (!rbac || typeof rbac.hasPermission !== 'function') {
      throw new TypeError('AuthorizationService requires an RBAC repository');
    }
    this.rbac = rbac;
  }

  async requirePermission({ tenantId, membershipId, permission }) {
    const allowed = await this.rbac.hasPermission(tenantId, membershipId, permission);
    if (!allowed) {
      const error = new Error('Permission denied');
      error.code = 'MVT_RBAC_FORBIDDEN';
      throw error;
    }
    return true;
  }
}
