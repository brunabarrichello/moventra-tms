import { MEMBERSHIP_STATUS } from '../membership/membership-domain.js';
import { USER_STATUS } from '../user/user-domain.js';

export class AuthIdentityResolver {
  constructor({ externalIdentities, users, memberships }) {
    if (!externalIdentities || !users || !memberships) {
      throw new TypeError('AuthIdentityResolver dependencies are required');
    }
    this.externalIdentities = externalIdentities;
    this.users = users;
    this.memberships = memberships;
  }

  async resolveForTenant(assertion, tenantId) {
    const externalIdentity = await this.externalIdentities.findByProviderSubject(
      assertion.providerKey,
      assertion.issuer,
      assertion.subject,
    );

    if (!externalIdentity || externalIdentity.status !== 'ACTIVE') {
      throw authResolutionError('MVT_AUTH_IDENTITY_UNAVAILABLE', 'External identity is not active');
    }

    const user = await this.users.findById(externalIdentity.userId);
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw authResolutionError('MVT_AUTH_USER_NOT_OPERATIONAL', 'User is not operational');
    }

    const membership = await this.memberships.findByUserId(tenantId, user.id);
    if (!membership || membership.status !== MEMBERSHIP_STATUS.ACTIVE) {
      throw authResolutionError(
        'MVT_AUTH_MEMBERSHIP_NOT_OPERATIONAL',
        'Membership is not operational for this Tenant',
      );
    }

    return Object.freeze({ user, membership, externalIdentity });
  }
}

function authResolutionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
