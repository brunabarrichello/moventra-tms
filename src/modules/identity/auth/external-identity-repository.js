import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  assertExternalIdentityTransition,
  normalizeAuthExpectedVersion,
  normalizeExternalIdentityCreation,
  normalizeIssuer,
  normalizeProviderKey,
  normalizeSubject,
  normalizeUuid,
} from './external-identity-domain.js';

const columns = `id, user_id, provider_key, issuer, subject, status, created_at, updated_at, version`;
export class PostgresExternalIdentityRepository {
  constructor({ query = queryDatabase } = {}) { if (typeof query !== 'function') throw new TypeError('query must be a function'); this.query = query; }
  async create(input) {
    const v = normalizeExternalIdentityCreation(input);
    try {
      const r = await this.query(`INSERT INTO identity.external_identities (user_id, provider_key, issuer, subject, status) VALUES ($1,$2,$3,$4,$5) RETURNING ${columns}`,[v.userId,v.providerKey,v.issuer,v.subject,v.status]);
      return map(r.rows[0]);
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'uq_external_identities_provider_issuer_subject') throw repoError('MVT_AUTH_EXTERNAL_IDENTITY_CONFLICT','External identity already linked');
      if (error?.code === '23503') throw repoError('MVT_AUTH_USER_NOT_FOUND','Canonical User was not found');
      throw error;
    }
  }
  async findByProviderSubject(providerKey, issuer, subject) {
    const r = await this.query(`SELECT ${columns} FROM identity.external_identities WHERE provider_key=$1 AND issuer=$2 AND subject=$3`,[normalizeProviderKey(providerKey),normalizeIssuer(issuer),normalizeSubject(subject)]);
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async findById(id) { const r = await this.query(`SELECT ${columns} FROM identity.external_identities WHERE id=$1`,[normalizeUuid(id)]); return r.rows[0] ? map(r.rows[0]) : null; }
  async transitionStatus(id, toStatus, expectedVersion) {
    const identityId = normalizeUuid(id); const version = normalizeAuthExpectedVersion(expectedVersion);
    const current = await this.query('SELECT status, version FROM identity.external_identities WHERE id=$1',[identityId]);
    if (!current.rows[0]) throw repoError('MVT_AUTH_EXTERNAL_IDENTITY_NOT_FOUND','External identity not found');
    if (String(current.rows[0].version) !== version) throw repoError('MVT_AUTH_VERSION_CONFLICT','External identity version conflict');
    assertExternalIdentityTransition(current.rows[0].status,toStatus);
    const r = await this.query(`UPDATE identity.external_identities SET status=$2, updated_at=now(), version=version+1 WHERE id=$1 AND status=$3 AND version=$4 RETURNING ${columns}`,[identityId,toStatus,current.rows[0].status,version]);
    if (!r.rows[0]) throw repoError('MVT_AUTH_VERSION_CONFLICT','External identity changed concurrently');
    return map(r.rows[0]);
  }
}
function map(row) { return { id:row.id,userId:row.user_id,providerKey:row.provider_key,issuer:row.issuer,subject:row.subject,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,version:String(row.version) }; }
function repoError(code,message){const e=new Error(message);e.code=code;return e;}
