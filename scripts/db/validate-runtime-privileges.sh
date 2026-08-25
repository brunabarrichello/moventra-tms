#!/usr/bin/env bash
set -euo pipefail

role="${RUNTIME_DATABASE_ROLE:-}"
if [[ -z "$role" ]]; then
  echo 'RUNTIME_DATABASE_ROLE is required' >&2
  exit 1
fi
if [[ ! "$role" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo 'RUNTIME_DATABASE_ROLE must be a valid lowercase PostgreSQL role identifier' >&2
  exit 1
fi

sql_literal="'${role}'"

assert_true() {
  local label="$1"
  local expression="$2"
  local result
  result="$(psql -X --no-psqlrc -Atq -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN (${expression}) THEN 'true' ELSE 'false' END")"
  if [[ "$result" != 'true' ]]; then
    echo "Runtime privilege assertion failed: ${label}" >&2
    exit 1
  fi
}

for schema in organization identity security audit; do
  assert_true "USAGE on schema ${schema}" "has_schema_privilege(${sql_literal}, '${schema}', 'USAGE')"
done

for table in \
  organization.tenants organization.companies organization.branches \
  identity.users identity.memberships identity.external_identities \
  security.roles security.membership_roles security.organizational_scopes; do
  assert_true "SELECT on ${table}" "has_table_privilege(${sql_literal}, '${table}', 'SELECT')"
  assert_true "INSERT on ${table}" "has_table_privilege(${sql_literal}, '${table}', 'INSERT')"
  assert_true "UPDATE on ${table}" "has_table_privilege(${sql_literal}, '${table}', 'UPDATE')"
  assert_true "no DELETE on ${table}" "NOT has_table_privilege(${sql_literal}, '${table}', 'DELETE')"
done

assert_true "SELECT-only permission catalog" "has_table_privilege(${sql_literal}, 'security.permissions', 'SELECT') AND NOT has_table_privilege(${sql_literal}, 'security.permissions', 'INSERT') AND NOT has_table_privilege(${sql_literal}, 'security.permissions', 'UPDATE') AND NOT has_table_privilege(${sql_literal}, 'security.permissions', 'DELETE')"

for table in security.role_permissions security.role_assignment_scopes; do
  assert_true "SELECT on ${table}" "has_table_privilege(${sql_literal}, '${table}', 'SELECT')"
  assert_true "INSERT on ${table}" "has_table_privilege(${sql_literal}, '${table}', 'INSERT')"
  assert_true "DELETE on ${table}" "has_table_privilege(${sql_literal}, '${table}', 'DELETE')"
  assert_true "no UPDATE on ${table}" "NOT has_table_privilege(${sql_literal}, '${table}', 'UPDATE')"
done

assert_true "append-only audit privileges" "has_table_privilege(${sql_literal}, 'audit.audit_events', 'SELECT') AND has_table_privilege(${sql_literal}, 'audit.audit_events', 'INSERT') AND NOT has_table_privilege(${sql_literal}, 'audit.audit_events', 'UPDATE') AND NOT has_table_privilege(${sql_literal}, 'audit.audit_events', 'DELETE')"
assert_true "current_tenant_id execute" "has_function_privilege(${sql_literal}, 'security.current_tenant_id()', 'EXECUTE')"
assert_true "runtime is not privileged" "NOT (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolcanlogin FROM pg_roles WHERE rolname = ${sql_literal})"

policy_count="$(psql -X --no-psqlrc -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_policies WHERE policyname LIKE 'tenant_isolation_%'")"
if [[ "$policy_count" -lt 10 ]]; then
  echo "Expected at least 10 tenant isolation policies, found ${policy_count}" >&2
  exit 1
fi

echo "Runtime PostgreSQL privilege contract validated for ${role}."
