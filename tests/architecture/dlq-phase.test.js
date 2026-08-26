import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('db/migrations/0017_dlq.sql', 'utf8');
const ingestionMigration = fs.readFileSync('db/migrations/0018_dlq_worker_ingestion.sql', 'utf8');
const runtimeAccess = fs.readFileSync('db/runtime/runtime-access.sql', 'utf8');
const workerAccess = fs.readFileSync('db/runtime/worker-access.sql', 'utf8');
const domain = fs.readFileSync('src/modules/dlq/dlq-contract.js', 'utf8');
const repository = fs.readFileSync('src/infrastructure/dlq/postgres-dlq-repository.js', 'utf8');
const messageReprocessor = fs.readFileSync('src/modules/dlq/message-reprocessor.js', 'utf8');
const outboxRepository = fs.readFileSync('src/modules/outbox/outbox-repository.js', 'utf8');
const ingestionRepository = fs.readFileSync('src/infrastructure/dlq/system-dlq-ingestion-repository.js', 'utf8');
const ingestionAdapter = fs.readFileSync('src/infrastructure/dlq/rabbitmq-dlq-ingestion.js', 'utf8');
const documentation = fs.readFileSync('docs/implementation/026-dlq.md', 'utf8');

test('026 mantém tenant e system DLQ fisicamente separados', () => {
  assert.match(migration, /CREATE TABLE dlq\.entries \(/);
  assert.match(migration, /tenant_id UUID NOT NULL/);
  assert.match(migration, /ALTER TABLE dlq\.entries ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = security\.current_tenant_id\(\)/);
  assert.match(migration, /CREATE TABLE dlq\.system_entries \(/);

  const systemTable = migration
    .split('CREATE TABLE dlq.system_entries (')[1]
    .split('CREATE UNIQUE INDEX ux_dlq_system_entries_source')[0];
  assert.doesNotMatch(systemTable, /tenant_id\s+UUID/);
});

test('026 possui dedupe, bounded retry e catálogo RBAC estável', () => {
  assert.match(migration, /ux_dlq_entries_source/);
  assert.match(migration, /ux_dlq_system_entries_source/);
  assert.match(migration, /max_reprocess_attempts BETWEEN 1 AND 25/);
  assert.match(migration, /reprocess_count <= max_reprocess_attempts/);
  assert.match(migration, /'dlq\.read'/);
  assert.match(migration, /'dlq\.reprocess'/);
  assert.match(migration, /'dlq\.resolve'/);
  assert.match(migration, /'dlq\.discard'/);
});

test('normal application runtime não pode inserir DLQ nem acessar system_entries', () => {
  assert.match(runtimeAccess, /GRANT SELECT ON dlq\.entries/);
  assert.match(runtimeAccess, /REVOKE INSERT, DELETE ON dlq\.entries/);
  assert.match(runtimeAccess, /REVOKE ALL PRIVILEGES ON dlq\.system_entries/);
  assert.match(runtimeAccess, /REVOKE UPDATE \([\s\S]*snapshot,[\s\S]*metadata,[\s\S]*\) ON dlq\.entries/);
});

test('worker recebe somente capability estreita de ingestão e nenhum acesso direto à DLQ', () => {
  assert.match(workerAccess, /GRANT USAGE ON SCHEMA jobs, outbox, dlq/);
  assert.match(workerAccess, /REVOKE ALL PRIVILEGES ON dlq\.entries/);
  assert.match(workerAccess, /REVOKE ALL PRIVILEGES ON dlq\.system_entries/);
  assert.match(workerAccess, /GRANT EXECUTE ON FUNCTION dlq\.quarantine_outbox_message/);
  assert.match(ingestionMigration, /SECURITY DEFINER/);
  assert.match(ingestionMigration, /FROM outbox\.events AS event/);
  assert.doesNotMatch(
    ingestionMigration.split('CREATE OR REPLACE FUNCTION dlq.quarantine_outbox_message')[1].split(')\nRETURNS')[0],
    /tenant/i,
  );
});

test('trust boundary de ingestão nunca deriva Tenant de headers ou x-death', () => {
  assert.doesNotMatch(ingestionRepository, /tenantId\s*[,}]/);
  assert.match(ingestionAdapter, /x-death/);
  assert.match(ingestionAdapter, /never trusted to select a tenant|never here/i);
  assert.match(ingestionMigration, /never trusted to select a tenant/i);
});

test('reprocessamento de mensagem relê Outbox autoritativo e reutiliza mapper/provider-neutral publisher', () => {
  assert.match(messageReprocessor, /sourceReader\.findById/);
  assert.match(messageReprocessor, /mapOutboxEventToMessage/);
  assert.match(messageReprocessor, /assertMessagingPublisher/);
  assert.match(messageReprocessor, /publisher\.publish\(message\)/);
  assert.match(messageReprocessor, /source\.tenantId !== entry\.tenantId/);
  assert.match(messageReprocessor, /source\.eventType !== entry\.sourceType/);
  assert.doesNotMatch(messageReprocessor, /from ['"]amqplib['"]/);
  assert.doesNotMatch(messageReprocessor, /exchange\s*[:=]/i);
  assert.doesNotMatch(messageReprocessor, /queue\s*[:=]/i);

  const reprocessSignature = messageReprocessor.match(/async reprocess\(\{([^}]*)\}/)?.[1] ?? '';
  assert.match(reprocessSignature, /id/);
  assert.match(reprocessSignature, /expectedVersion/);
  assert.doesNotMatch(reprocessSignature, /payload|routingKey|exchange|queue|eventType|tenantId/i);
});

test('Outbox expõe somente lookup por id sob RLS para reconstrução autoritativa', () => {
  assert.match(outboxRepository, /async findById\(\{ id \}\)/);
  assert.match(outboxRepository, /FROM outbox\.events/);
  assert.match(outboxRepository, /WHERE id = \$1/);
  assert.match(runtimeAccess, /GRANT SELECT, INSERT ON outbox\.events/);
  assert.match(migration.replaceAll('dlq', 'dlq'), /CREATE TABLE dlq\.entries/);
});

test('cooldown de reprocessamento é enforceado no SQL e não apenas na aplicação', () => {
  const requestMethod = repository
    .split('async requestReprocess')[1]
    .split('async claimReprocess')[0];
  assert.match(requestMethod, /next_reprocess_at IS NULL OR next_reprocess_at <= clock_timestamp\(\)/);
  assert.match(requestMethod, /version = \$2/);
  assert.match(requestMethod, /status = 'quarantined'/);
});

test('domínio DLQ é provider-neutral e provider-specific fica em infrastructure', () => {
  assert.doesNotMatch(domain, /from ['"]pg['"]/);
  assert.doesNotMatch(domain, /from ['"]amqplib['"]/);
  assert.doesNotMatch(repository, /from ['"]amqplib['"]/);
  assert.doesNotMatch(ingestionRepository, /from ['"]amqplib['"]/);
  assert.doesNotMatch(messageReprocessor, /from ['"]amqplib['"]/);
  assert.match(documentation, /provider-neutral/i);
  assert.match(documentation, /Production somente após gate humano explícito/i);
});
