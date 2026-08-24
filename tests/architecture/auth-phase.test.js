import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync('db/migrations/0007_external_identity.sql','utf8');
test('phase 013 creates provider-agnostic external identity only',()=>{
 assert.match(migration,/CREATE TABLE identity\.external_identities/);
 assert.match(migration,/UNIQUE \(provider_key, issuer, subject\)/);
 assert.doesNotMatch(migration,/password_hash|access_token|refresh_token|session_id|role_id|permission_id|company_id|branch_id/i);
});
