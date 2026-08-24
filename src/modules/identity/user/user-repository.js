import { queryDatabase } from '../../../infrastructure/database/postgres.js';
import {
  assertUserTransition,
  normalizeUserCreation,
  normalizeUserExpectedVersion,
  normalizeUserPrimaryEmail,
  normalizeUserProfileUpdate,
} from './user-domain.js';

const userColumns = `
  id,
  primary_email,
  display_name,
  preferred_locale,
  preferred_timezone,
  status,
  created_at,
  updated_at,
  version
`;

export class PostgresUserRepository {
  constructor({ query = queryDatabase } = {}) {
    if (typeof query !== 'function') {
      throw new TypeError('User repository query dependency must be a function');
    }

    this.query = query;
  }

  async create(input) {
    const user = normalizeUserCreation(input);

    try {
      const result = await this.query(
        `INSERT INTO identity.users (
           primary_email,
           display_name,
           preferred_locale,
           preferred_timezone,
           status
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${userColumns}`,
        [
          user.primaryEmail,
          user.displayName,
          user.preferredLocale,
          user.preferredTimezone,
          user.status,
        ],
      );

      return mapUserRow(result.rows[0]);
    } catch (error) {
      throw mapUserWriteError(error);
    }
  }

  async findById(id) {
    const userId = normalizeUuid(id);
    const result = await this.query(
      `SELECT ${userColumns}
         FROM identity.users
        WHERE id = $1`,
      [userId],
    );

    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async findByPrimaryEmail(primaryEmail) {
    const email = normalizeUserPrimaryEmail(primaryEmail);
    const result = await this.query(
      `SELECT ${userColumns}
         FROM identity.users
        WHERE primary_email = $1`,
      [email],
    );

    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async updateProfile(id, input, expectedVersion) {
    const userId = normalizeUuid(id);
    const profile = normalizeUserProfileUpdate(input);
    const version = normalizeUserExpectedVersion(expectedVersion);

    try {
      const result = await this.query(
        `UPDATE identity.users
            SET primary_email = $2,
                display_name = $3,
                preferred_locale = $4,
                preferred_timezone = $5,
                updated_at = now(),
                version = version + 1
          WHERE id = $1
            AND version = $6
        RETURNING ${userColumns}`,
        [
          userId,
          profile.primaryEmail,
          profile.displayName,
          profile.preferredLocale,
          profile.preferredTimezone,
          version,
        ],
      );

      if (result.rows[0]) {
        return mapUserRow(result.rows[0]);
      }
    } catch (error) {
      throw mapUserWriteError(error);
    }

    await this.#throwNotFoundOrConflict(userId);
  }

  async transitionStatus(id, toStatus, expectedVersion) {
    const userId = normalizeUuid(id);
    const version = normalizeUserExpectedVersion(expectedVersion);
    const current = await this.#findState(userId);

    if (!current) {
      throw userRepositoryError('MVT_USER_NOT_FOUND', 'User was not found');
    }

    if (current.version !== version) {
      throw userRepositoryError(
        'MVT_USER_VERSION_CONFLICT',
        'User version does not match the expected version',
      );
    }

    assertUserTransition(current.status, toStatus);

    const result = await this.query(
      `UPDATE identity.users
          SET status = $2,
              updated_at = now(),
              version = version + 1
        WHERE id = $1
          AND status = $3
          AND version = $4
      RETURNING ${userColumns}`,
      [userId, toStatus, current.status, version],
    );

    if (result.rows[0]) {
      return mapUserRow(result.rows[0]);
    }

    await this.#throwNotFoundOrConflict(userId);
  }

  async #findState(userId) {
    const result = await this.query(
      `SELECT status, version
         FROM identity.users
        WHERE id = $1`,
      [userId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      status: result.rows[0].status,
      version: String(result.rows[0].version),
    };
  }

  async #throwNotFoundOrConflict(userId) {
    const result = await this.query(
      `SELECT version
         FROM identity.users
        WHERE id = $1`,
      [userId],
    );

    if (!result.rows[0]) {
      throw userRepositoryError('MVT_USER_NOT_FOUND', 'User was not found');
    }

    throw userRepositoryError(
      'MVT_USER_VERSION_CONFLICT',
      'User was modified by another operation',
    );
  }
}

function mapUserWriteError(error) {
  if (error?.code === '23505' && error?.constraint === 'uq_users_primary_email') {
    return userRepositoryError(
      'MVT_USER_EMAIL_CONFLICT',
      'A User with the same canonical primary email already exists',
    );
  }

  return error;
}

function mapUserRow(row) {
  if (!row) {
    throw new Error('User repository expected a database row');
  }

  return {
    id: row.id,
    primaryEmail: row.primary_email,
    displayName: row.display_name,
    preferredLocale: row.preferred_locale,
    preferredTimezone: row.preferred_timezone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: String(row.version),
  };
}

function normalizeUuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw userRepositoryError('MVT_USER_ID_INVALID', 'User id must be a canonical UUID');
  }

  return value.toLowerCase();
}

function userRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
