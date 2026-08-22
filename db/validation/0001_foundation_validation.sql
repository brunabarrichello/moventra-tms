-- Moventra TMS — Validation for migration 0001
-- Read-only checks intended for the temporary Neon migration branch.

-- 1. Expected schemas.
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('organization', 'identity', 'audit')
ORDER BY schema_name;

-- 2. Expected foundation tables.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('organization', 'identity', 'audit')
  AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name;

-- 3. Primary/unique/foreign/check constraints.
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema IN ('organization', 'identity', 'audit')
ORDER BY tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4. Index inventory.
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname IN ('organization', 'identity', 'audit')
ORDER BY schemaname, tablename, indexname;

-- 5. UUIDv7 defaults on entity IDs.
SELECT
    table_schema,
    table_name,
    column_name,
    column_default
FROM information_schema.columns
WHERE table_schema IN ('organization', 'identity', 'audit')
  AND column_name = 'id'
ORDER BY table_schema, table_name;

-- 6. Audit append-only trigger.
SELECT
    event_object_schema,
    event_object_table,
    trigger_name,
    event_manipulation,
    action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'audit'
  AND event_object_table = 'audit_logs'
ORDER BY trigger_name, event_manipulation;

-- 7. Verify no business-domain schemas were introduced by migration 0001.
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN (
    'crm', 'commercial', 'operations', 'drivers', 'fleet', 'tracking',
    'risk', 'finance', 'fiscal', 'notifications', 'integrations', 'billing'
)
ORDER BY schema_name;
