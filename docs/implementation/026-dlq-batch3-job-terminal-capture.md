# 026 — DLQ — Batch 3: Captura atômica de Jobs `failed_terminal`

## Estado

`ACTIVE / IMPLEMENTED IN BRANCH / AWAITING CI`

Este Batch pertence exclusivamente à fase **026 — DLQ**. A fase **027 — Object Storage permanece NOT ACTIVE**.

## Contexto

A fase 025 já persiste Jobs duráveis em PostgreSQL e possui dois caminhos capazes de chegar ao estado terminal:

1. `completeFailure(...)` quando o handler não é retryable ou esgota `max_attempts`;
2. `reapExpiredExhausted()` quando um Job em `running` perde o lease já no limite de tentativas.

Antes deste Batch, ambos podiam persistir `failed_terminal` sem criar, na mesma transação, o registro operacional durável correspondente na DLQ.

Isso violava o objetivo da fase 026 de tornar falhas terminais recuperáveis e governáveis sem depender de janela eventual entre:

```text
job failed_terminal
+
DLQ entry
```

## Decisão

Como Jobs e DLQ estão no mesmo PostgreSQL, a captura passa a ocorrer por **trigger transacional no banco**, e não por uma segunda chamada JavaScript após o `UPDATE` do Job.

Fluxo:

```text
Job Worker / lease reaper
        ↓
UPDATE jobs.* → failed_terminal
        ↓
AFTER UPDATE trigger
        ↓
SECURITY DEFINER capture function
        ↓
INSERT idempotente em dlq.*
        ↓
COMMIT único
```

Se a gravação da DLQ falhar, a transação que produziria `failed_terminal` também falha. Não existe janela na qual o Job seja terminal e a intenção de quarentena tenha sido perdida silenciosamente.

## Escopos físicos

A convenção multi-tenant vigente permanece preservada:

```text
jobs.jobs
  → tenant_id UUID NOT NULL
  → dlq.entries

jobs.system_jobs
  → sem tenant_id
  → dlq.system_entries
```

Não é utilizado `tenant_id NULL` para representar falha system-scoped.

## Migration

Arquivo:

```text
db/migrations/0019_dlq_job_terminal_capture.sql
```

Funções:

```text
dlq.capture_terminal_tenant_job()
dlq.capture_terminal_system_job()
```

Triggers:

```text
trg_jobs_jobs_capture_terminal_dlq
trg_jobs_system_jobs_capture_terminal_dlq
```

Ambas as funções são `SECURITY DEFINER`, possuem `search_path` controlado e têm `EXECUTE` revogado de `PUBLIC`.

## Tenant authority

Para `jobs.jobs`, o `tenant_id` usado na DLQ vem **exclusivamente de `NEW.tenant_id` da linha autoritativa do Job**.

A captura não recebe Tenant de:

- payload;
- metadata;
- headers;
- request externo;
- operador;
- RabbitMQ.

## Snapshot minimizado

A captura automática não copia o payload bruto do Job.

Snapshot permitido:

```text
jobId
tenantId              # apenas tenant-scoped
jobType
schemaVersion
attemptCount
maxAttempts
payload.omitted = authoritative_job_reference
```

Metadata permitida:

```text
origin = jobs.failed_terminal
completedAt
scheduleKey            # quando existente
```

O payload original continua no Job autoritativo e somente poderá ser consultado/reutilizado por capability governada durante o futuro reprocessamento.

Essa decisão reduz duplicação de dados sensíveis e evita transformar a DLQ em dump irrestrito de payload.

## Failure code/class

A captura reutiliza `last_error_code` e `last_error_class` somente quando satisfazem os contratos canônicos de formato.

Fallbacks seguros:

```text
failure_code  = MVT_JOB_FAILED_TERMINAL
failure_class = terminal
```

Nenhuma mensagem arbitrária de exception/provider é persistida como failure code pesquisável.

## Dedupe

A migration reutiliza as chaves da fase 026:

Tenant:

```text
(tenant_id, source_kind, source_id)
```

System:

```text
(source_kind, source_id)
```

Com:

```text
source_kind = job
source_id   = jobs.*.id
```

A mesma ocorrência terminal não produz duas entradas lógicas.

## Validação PostgreSQL real

Arquivo:

```text
db/validation/0019_dlq_job_terminal_capture_validation.sql
```

O teste verifica:

- funções presentes;
- `SECURITY DEFINER`;
- `PUBLIC EXECUTE` revogado;
- triggers presentes e habilitados;
- captura tenant-scoped;
- captura system-scoped;
- Tenant/source corretos;
- failure code/class preservados quando válidos;
- status inicial `quarantined`;
- payload bruto não copiado para snapshot;
- dedupe após update repetido do estado terminal;
- limpeza das fixtures ao final.

O workflow `.github/workflows/dlq-contract.yml` executa esta validação após aplicar a história completa de migrations em PostgreSQL 18 real.

## Impacto no Worker

Nenhuma permissão cross-tenant adicional é concedida ao Worker.

O Worker continua usando o `PostgresJobRepository` vigente. A transição terminal já executada por esse repository aciona a captura no banco dentro da mesma transação.

Portanto, o Batch cobre tanto:

```text
completeFailure()
```

quanto:

```text
reapExpiredExhausted()
```

sem duplicar lógica de DLQ no domínio/worker.

## Rollback

Como a migration é forward-only no framework canônico, rollback operacional de release deve impedir promoção ou restaurar a revisão/runtime conforme os gates vigentes. Uma eventual correção de schema posterior deve ser feita por nova migration forward-fix; migrations aplicadas não são editadas retroativamente.

## Critério de aceite do Batch 3

- [x] design transacional definido;
- [x] tenant/system fisicamente separados;
- [x] migration 0019 materializada na branch;
- [x] snapshot minimizado sem payload bruto;
- [x] validation SQL materializada na branch;
- [x] DLQ Contract CI atualizado para executar a validation 0019;
- [ ] PR aberta;
- [ ] CI completo verde;
- [ ] merge na `main`;
- [ ] Staging evidenciado;
- [ ] rollback/restore evidenciado quando aplicável;
- [ ] Production somente após aprovação humana explícita;
- [ ] evidência pós-promoção registrada.

## O que este Batch NÃO conclui

Ainda permanecem dentro da fase 026:

- reprocessamento governado de mensagens;
- reprocessamento governado de Jobs;
- APIs administrativas;
- RBAC/tenant scope dessas APIs;
- `Idempotency-Key` nas mutações;
- Audit das ações humanas;
- optimistic concurrency na superfície administrativa;
- testes finais de concorrência/reprocessamento;
- smoke final da fase;
- fechamento documental e da Issue #115.

Somente após todo esse escopo estar `EVIDENCED / CONCLUDED` a fase 027 poderá ser ativada.
