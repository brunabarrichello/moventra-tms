import { spawnSync } from 'node:child_process';

const role = process.env.RUNTIME_DATABASE_ROLE?.trim();
if (!role) {
  throw new Error('RUNTIME_DATABASE_ROLE is required');
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
  throw new Error('RUNTIME_DATABASE_ROLE must be a valid lowercase PostgreSQL role identifier');
}

const statements = [
  `GRANT USAGE ON SCHEMA organization, identity, security, audit TO ${role};`,
  `GRANT SELECT, INSERT, UPDATE ON TABLE organization.tenants, organization.companies, organization.branches TO ${role};`,
  `GRANT SELECT, INSERT, UPDATE ON TABLE identity.users, identity.memberships, identity.external_identities TO ${role};`,
  `GRANT SELECT ON TABLE security.permissions TO ${role};`,
  `GRANT SELECT, INSERT, UPDATE ON TABLE security.roles, security.membership_roles, security.organizational_scopes TO ${role};`,
  `GRANT SELECT, INSERT, DELETE ON TABLE security.role_permissions, security.role_assignment_scopes TO ${role};`,
  `GRANT SELECT, INSERT ON TABLE audit.audit_events TO ${role};`,
  `GRANT EXECUTE ON FUNCTION security.current_tenant_id() TO ${role};`,
];

const args = ['-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1'];
for (const statement of statements) {
  args.push('-c', statement);
}

const result = spawnSync('psql', args, {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Runtime PostgreSQL privilege contract applied to ${role}.`);
