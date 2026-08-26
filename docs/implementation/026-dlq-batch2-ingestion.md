# 026 — DLQ — Batch 2: RabbitMQ DLX/DLQ Ingestion

## Estado

`IMPLEMENTED / AWAITING CI + STAGING EVIDENCE`

Este batch pertence integralmente à fase **026 — DLQ**. A fase 027 permanece `NOT ACTIVE`.

## Objetivo

Completar o caminho durável de ingestão de mensagens dead-lettered:

```text
primary consumer queue
  -> nack(requeue=false)
  -> RabbitMQ DLX
  -> durable ingestion queue
  -> worker DLQ ingestion consumer
  -> narrow PostgreSQL capability
  -> dlq.entries
```

## Decisões

- RabbitMQ é adapter de transporte; PostgreSQL continua fonte operacional durável/auditável da DLQ.
- `dlq.entries` continua tenant-scoped com `tenant_id NOT NULL` e RLS.
- O Worker continua `NOBYPASSRLS` e sem acesso direto a `outbox.events`, `dlq.entries` ou `dlq.system_entries`.
- A migration `0018_dlq_worker_ingestion.sql` adiciona apenas `dlq.quarantine_outbox_message(...)`, uma capability `SECURITY DEFINER` com `PUBLIC EXECUTE` revogado.
- Tenant, source type, schema version e snapshot operacional são derivados da linha autoritativa de `outbox.events` pelo `event_id`. Headers, `x-death` e payload recebido do broker não selecionam Tenant.
- A ingestão é idempotente pela unicidade já definida em 0017: `(tenant_id, source_kind, source_id)`.
- A fila de ingestão não possui DLX próprio, impedindo ciclo DLQ -> DLQ.
- Mensagem válida só recebe ACK após confirmação de persistência PostgreSQL.
- Falha temporária de persistência usa retry bounded em memória e no máximo uma redelivery do broker; segunda entrega esgotada é rejeitada sem requeue para impedir hot loop.
- Poison message sem source id resolvível é rejeitada sem requeue.

## Artefatos

```text
db/migrations/0018_dlq_worker_ingestion.sql
db/validation/0018_dlq_worker_ingestion_validation.sql
db/runtime/worker-access.sql
db/runtime/worker-access-validation.sql
src/infrastructure/dlq/system-dlq-ingestion-repository.js
src/infrastructure/dlq/rabbitmq-dlq-config.js
src/infrastructure/dlq/rabbitmq-dlq-ingestion.js
src/worker.js
scripts/ci/validate-dlq-ingestion.mjs
.github/workflows/dlq-contract.yml
```

## Configuração

Todos os valores permanecem bounded e versionados apenas como nomes em `.env.example`:

```text
DLQ_RABBITMQ_DLX
DLQ_RABBITMQ_QUEUE
DLQ_RABBITMQ_PREFETCH
DLQ_INGEST_PERSIST_RETRIES
DLQ_INGEST_RETRY_BASE_MS
DLQ_INGEST_RETRY_MAX_MS
```

Defaults de código:

```text
DLX                  = moventra.dlx
queue                = moventra.dlq.ingest
prefetch             = 10
persistence retries  = 5
retry base            = 250 ms
retry max             = 5000 ms
```

## Testes do batch

O workflow `Moventra DLQ Contract` usa PostgreSQL 18 e RabbitMQ real para provar:

- migrations 0017 + 0018;
- RLS e least privilege;
- worker sem acesso direto às tabelas;
- capability estreita com tenant derivado do Outbox;
- DLX -> queue -> consumer -> PostgreSQL;
- ACK após persistência;
- dedupe de dead-letter repetido;
- poison sem loop;
- bootstrap do Worker com consumer DLQ ativo.

## Próximos batches dentro da 026

Após este batch ficar verde/evidenciado:

1. captura durável de `jobs.failed_terminal`;
2. reprocessamento governado de message/job;
3. APIs administrativas tenant-scoped com RBAC, Idempotency-Key, Audit e optimistic concurrency;
4. validação consolidada em Staging;
5. rollback/restore;
6. Production somente após aprovação humana explícita.

Nenhum passo deste batch autoriza aplicar migrations 0017/0018 ou promover runtime em Production sem o gate próprio da fase 026.
