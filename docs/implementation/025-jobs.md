# 025 — Jobs

## Estado

`EVIDENCED / CONCLUDED`

A fase 024 — Mensageria está concluída e a fase 025 — Jobs foi implementada, validada em CI, evidenciada em Staging, promovida de forma protegida para Production e comprovada em runtime real na revisão canônica `d6fcf32e56d812cc8df90fc9a4ef2191c18a4173`.

A fase 026 — DLQ é a próxima etapa oficial, porém permanece `NOT ACTIVE` até ativação explícita em uma execução subsequente.

Issue oficial: #110.

Página Confluence de conclusão: `025 — Jobs — Conclusão e Evidências` (page ID `6225921`).

## Objetivo

Introduzir o subsistema transversal de Jobs do Moventra TMS para execução assíncrona e recorrente com durabilidade, concorrência controlada, lease, heartbeat, retry/backoff, observabilidade e shutdown seguro, preservando o monólito modular e sem antecipar a governança administrativa da DLQ 026.

A primeira integração funcional obrigatória é o **Outbox Dispatcher**:

```text
claim Outbox
  ↓
map Outbox -> MessageEnvelope
  ↓
publish RabbitMQ + publisher confirm
  ↓
markPublished Outbox
```

## Decisão arquitetural

A 025 usa um framework interno provider-neutral no nível da aplicação e persistência PostgreSQL. O runtime de execução é um **processo de worker dedicado**, separado do runtime HTTP/serverless.

```text
Application / Domain
        │
        ├── agenda tenant job
        ▼
JobScheduler
        │
        ▼
PostgreSQL Durable Jobs
        │
        ├── jobs.jobs          (tenant-scoped, RLS)
        └── jobs.system_jobs   (technical/global)
                 │
                 ▼
        Dedicated Job Worker
                 │
                 ▼
        JobHandlerRegistry
                 │
                 └── system.outbox_dispatch
                           │
                           ▼
                Outbox -> RabbitMQ 024
```

Não introduzir Redis/BullMQ, Kubernetes Jobs ou SaaS de fila de jobs apenas para cumprir esta fase. PostgreSQL 18, `FOR UPDATE SKIP LOCKED`, leases e transações atendem ao requisito atual sem contaminar os handlers com tecnologia de infraestrutura.

## Decisão de escopo físico

A convenção canônica da fase 007 exige `tenant_id UUID NOT NULL` em toda tabela tenant-scoped. Portanto, **não** é permitido representar jobs tenant e system na mesma tabela por `tenant_id NULL`.

A modelagem física correta é:

```text
jobs.jobs
  = jobs pertencentes a tenant
  = tenant_id UUID NOT NULL
  = RLS obrigatório

jobs.system_jobs
  = jobs técnicos/globais da plataforma
  = NÃO possui tenant_id
  = schedules definidos por migration/configuração confiável
```

Essa separação evita enfraquecer a convenção de tenancy e torna a propriedade de cada job inequívoca.

No contrato de aplicação, o campo lógico `scope` continua existindo:

```text
tenant -> persiste em jobs.jobs
system -> persiste em jobs.system_jobs
```

O `PostgresJobRepository` recebe `scope` confiável no bootstrap e seleciona a tabela por catálogo interno fixo; nenhum nome de tabela é derivado de payload/input do usuário.

## Modelo de dados — `jobs.jobs`

Responsabilidade: jobs de negócio pertencentes a um tenant.

Campos principais:

```text
id                      uuid PK DEFAULT uuidv7()
tenant_id               uuid NOT NULL FK organization.tenants
job_type                text NOT NULL
schema_version          smallint NOT NULL
payload                  jsonb NOT NULL
metadata                 jsonb NOT NULL
status                   text NOT NULL
priority                 smallint NOT NULL
available_at             timestamptz NOT NULL
attempt_count            integer NOT NULL
max_attempts             smallint NOT NULL
lease_token              uuid NULL
leased_at                timestamptz NULL
lease_expires_at         timestamptz NULL
last_heartbeat_at        timestamptz NULL
last_error_code          text NULL
last_error_class         text NULL
schedule_key             text NULL
recurrence_interval_ms  bigint NULL
last_completed_at        timestamptz NULL
completed_at             timestamptz NULL
cancelled_at             timestamptz NULL
created_at               timestamptz NOT NULL
updated_at               timestamptz NOT NULL
```

RLS:

```text
USING      tenant_id = security.current_tenant_id()
WITH CHECK tenant_id = security.current_tenant_id()
```

Índices de elegibilidade são tenant-leading quando o padrão é tenant-scoped. O singleton recorrente tenant-aware usa unicidade parcial `(tenant_id, schedule_key)` para estados ativos.

## Modelo de dados — `jobs.system_jobs`

Responsabilidade: jobs técnicos/globais criados e governados pela plataforma.

Não possui `tenant_id`. Usa o mesmo lifecycle durável de lease/retry, com tipo restrito a namespace `system.*`.

A migration 0016 cria o primeiro schedule oficial:

```text
job_type                = system.outbox_dispatch
schedule_key            = system.outbox_dispatch
recurrence_interval_ms  = 1000
priority                = 100
max_attempts             = 10
```

O runtime web não pode criar, alterar ou apagar esse schedule. A definição é migration-owned; alterações futuras exigem mudança versionada de infraestrutura.

## State machine

Estado físico:

```text
scheduled
   │ available_at <= now
   ▼
running
   ├── success ────────────────→ succeeded
   │                              ou scheduled (recorrente)
   ├── retryable failure ──────→ retry_scheduled
   ├── max/non-retryable ──────→ failed_terminal
   └── tenant cancellation ────→ cancelled
```

`available` é derivado de `status + available_at`, não duplicado.

Toda conclusão exige o `lease_token` ainda ativo. Um worker que perdeu o lease não pode concluir o job.

## Claim e concorrência

O repositório usa claim atômico:

```sql
WITH eligible AS (
  SELECT id
    FROM <trusted_job_table>
   WHERE (
      (status IN ('scheduled', 'retry_scheduled') AND available_at <= clock_timestamp())
      OR (status = 'running' AND lease_expires_at <= clock_timestamp())
   )
     AND attempt_count < max_attempts
   ORDER BY priority DESC, available_at, created_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT $1
)
UPDATE <trusted_job_table> AS job
   SET status = 'running',
       lease_token = $2,
       leased_at = clock_timestamp(),
       lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
       last_heartbeat_at = clock_timestamp(),
       attempt_count = job.attempt_count + 1,
       updated_at = clock_timestamp()
  FROM eligible
 WHERE job.id = eligible.id
RETURNING job.*;
```

`<trusted_job_table>` é escolhido somente pelo `scope` configurado no repositório (`jobs.jobs` ou `jobs.system_jobs`), nunca por input livre.

Workers concorrentes não podem receber o mesmo lease ativo. Lease expirado pode ser recuperado; lease expirado com tentativas esgotadas transita para `failed_terminal`.

## Lease, heartbeat e timeout

Defaults iniciais:

```text
lease              = 60 s
heartbeat          = 20 s
batch              = 25
concurrency        = 5
idle poll          = 1 s
handler timeout    = 30 s
```

O `JobWorker`:

- usa `AbortController`;
- renova heartbeat apenas enquanto detém o lease;
- aborta o handler se perder ownership;
- aplica timeout bounded;
- processa em concorrência limitada;
- não faz busy-loop;
- em shutdown para novos claims e usa cancel signal cooperativo.

Um entrypoint HTTP/serverless **não pode** chamar `runForever()`. O loop recorrente pertence a um runtime de worker dedicado.

## Retry e backoff

Política central:

```text
delay = min(maxDelay, baseDelay * 2^(attempt-1)) + bounded jitter
```

Defaults:

```text
baseDelay    = 1 s
maxDelay     = 5 min
maxAttempts  = 10
jitter       <= 20%
```

Jitter é injetável para testes determinísticos. Erros somente são retryable quando a classificação explícita assim determina; mensagens de erro arbitrárias não são persistidas como dados operacionais.

## Handler Registry

`JobHandlerRegistry` mantém catálogo interno:

```text
job_type -> scope permitido + schemaVersions + handler
```

Regras:

- `job_type` namespaced e validado;
- duplicidade de registro rejeitada;
- incompatibilidade de scope rejeitada;
- schema version não suportado rejeitado;
- nenhum `eval`, `new Function` ou import dinâmico por payload;
- handler recebe contexto estruturado e `AbortSignal`.

## Outbox Dispatcher

Handler inicial:

```text
system.outbox_dispatch
```

Invariante crítica:

```text
publisher confirm SUCCESS
          ↓
markPublished(eventId, claimToken)
```

Nunca o inverso.

Fluxo de cada execução:

1. `OutboxService.claimBatch()` por capability interna;
2. mapear `outbox.events` para envelope canônico 024;
3. publicar via `MessagingPublisher`;
4. exigir `confirmed=true` e `messageId == event.id`;
5. somente então chamar `markPublished`;
6. falha deixa evento recuperável pelo claim TTL;
7. sucessos parciais do batch permanecem marcados; o primeiro erro é propagado como falha retryable quando aplicável.

A semântica continua **at-least-once**. Não existe promessa de exactly-once fim a fim.

## Boundary de segurança — runtime web x worker

A 025 introduz separação de principal PostgreSQL:

### Application runtime

Contrato: `db/runtime/runtime-access.sql`.

Pode:

- agendar/consultar tenant jobs sob RLS;
- mutar apenas colunas operacionais tenant-scoped autorizadas;
- usar Outbox tenant-scoped conforme contratos anteriores.

Não pode:

- ler ou mutar `jobs.system_jobs`;
- executar `outbox.claim_system_batch`;
- executar `outbox.mark_system_published`;
- obter bypass de RLS.

### Dedicated worker

Contrato: `db/runtime/worker-access.sql`.

Pode apenas:

- `USAGE` em `jobs` e `outbox`;
- `SELECT` do schedule técnico em `jobs.system_jobs`;
- atualizar somente lifecycle/lease desse schedule;
- executar as duas capabilities estreitas de Outbox.

Não pode:

- `INSERT`/`DELETE` de system jobs;
- redefinir `job_type`, payload, metadata, schedule key ou recurrence;
- acessar diretamente `outbox.events`;
- acessar diretamente `jobs.jobs` tenant-scoped nesta primeira integração;
- acessar schemas de negócio, identidade, RBAC, auditoria/configuração;
- criar objetos;
- BYPASSRLS.

Essa segregação reduz blast radius e impede que comprometimento do runtime HTTP conceda automaticamente poder cross-tenant de despacho.

## Capability cross-tenant do Outbox

O Outbox Dispatcher precisa localizar eventos de múltiplos tenants sem dar `BYPASSRLS` ao worker. A migration cria funções estreitas `SECURITY DEFINER`:

```text
outbox.claim_system_batch(limit, claim_ttl_ms, claim_token)
outbox.mark_system_published(event_id, claim_token)
```

Propriedades:

- `PUBLIC EXECUTE` revogado;
- somente a role dedicada de worker recebe `EXECUTE`;
- limit e TTL validados no banco;
- `markPublished` exige `claim_token` proprietário;
- nenhuma capability permite append arbitrário, DELETE ou alteração de payload/tenant/event contract;
- `search_path` fixado em `pg_catalog` e objetos de aplicação referenciados de forma qualificada.

## Tenant Jobs

A 025 materializa persistência, agendamento, claim e worker genéricos para tenant jobs, mas a primeira execução operacional ativada é exclusivamente `system.outbox_dispatch`.

Qualquer worker futuro que varra jobs de múltiplos tenants deverá receber capability explícita e estreita própria, com tenant context estabelecido antes do handler. **Não** será concedido acesso cross-tenant genérico antecipadamente.

## Scheduler e recorrência

Suportado:

- one-shot por `available_at`;
- atraso relativo no chamador;
- schedule singleton por chave;
- recorrência interna bounded para system jobs migration-owned;
- cancelamento de tenant job antes de execução quando permitido.

No sucesso de job recorrente, a mesma linha volta a `scheduled`, `attempt_count` é resetado e `available_at` avança pelo intervalo configurado. Isso evita explosão de linhas duplicadas do scheduler.

Cron arbitrário fornecido por usuário permanece fora de escopo.

## Configuração

Parâmetros de worker devem ser env/configuração confiável e possuir min/max:

```text
JOBS_BATCH_SIZE=25
JOBS_CONCURRENCY=5
JOBS_LEASE_MS=60000
JOBS_HEARTBEAT_MS=20000
JOBS_IDLE_POLL_MS=1000
JOBS_HANDLER_TIMEOUT_MS=30000
JOBS_RETRY_BASE_MS=1000
JOBS_RETRY_MAX_MS=300000
JOBS_DEFAULT_MAX_ATTEMPTS=10
OUTBOX_DISPATCH_BATCH_SIZE=50
OUTBOX_DISPATCH_CLAIM_TTL_MS=60000
```

Credenciais esperadas no runtime dedicado:

```text
DATABASE_URL=<worker PostgreSQL credential, secret>
MESSAGING_RABBITMQ_URL=<worker RabbitMQ credential, secret>
```

Production e Staging usam credenciais segregadas por ambiente. A credencial PostgreSQL do worker não é a mesma do runtime web.

## Observabilidade

Implementado:

```text
jobs_operations_total{operation,outcome,job_type,environment}
jobs_operation_duration_ms{operation,outcome,job_type,environment}
```

`job_type` pertence ao catálogo controlado. IDs de alta cardinalidade não são labels.

Nunca usar como label:

```text
jobId
tenantId
leaseToken
correlationId
payload
error message arbitrária
```

Telemetry é fail-safe: erro no exportador não altera a correção do job.

## Idempotência

Jobs são at-least-once. Um worker pode morrer depois de produzir efeito e antes de registrar sucesso.

Portanto:

- handlers com efeito externo precisam de Idempotência 022/provider/domain dedupe;
- Outbox Dispatcher usa `eventId/messageId` estáveis;
- `markPublished` é condicional ao claim;
- lease não transforma o sistema em exactly-once.

## Testes e evidência obrigatória

### Unitários

- validação de scope, payload e metadata;
- bloqueio de campos sensíveis;
- backoff/jitter determinístico;
- Handler Registry;
- worker success/retry;
- confirm-before-markPublished;
- falha de broker sem markPublished.

### PostgreSQL

- migration 0016 em banco limpo;
- `tenant_id NOT NULL` e RLS em `jobs.jobs`;
- ausência de `tenant_id` em `jobs.system_jobs`;
- singleton system schedule;
- `SKIP LOCKED` com workers concorrentes;
- heartbeat e conclusão por lease;
- retry scheduling;
- app runtime least privilege;
- dedicated worker least privilege;
- aplicação normal sem capability cross-tenant;
- worker sem acesso direto a Outbox/business data.

### RabbitMQ real em CI

Workflow `Moventra Jobs Contract` sobe PostgreSQL 18 + RabbitMQ 4.3.5 e executa:

```text
seed Outbox event
  ↓
SET ROLE dedicated worker CI principal
  ↓
JobWorker.runOnce()
  ↓
system.outbox_dispatch
  ↓
claim Outbox capability
  ↓
RabbitMQ publish + confirm
  ↓
consumer recebe envelope
  ↓
markPublished
  ↓
system job volta a scheduled
```

A evidência só é válida se todo o fluxo passar sob o principal dedicado de worker; executar como owner/admin não é suficiente.

## Release e evidências finais

Critérios de release concluídos:

- CI completo verde;
- migration 0016 aplicada em Staging e Production;
- worker PostgreSQL role/credential de menor privilégio em Staging e Production;
- runtime dedicado de worker executando continuamente em Staging e Production;
- broker real segregado por ambiente;
- Outbox Dispatcher observado em execução real;
- rollback/restore comprovado em Staging;
- mesma arquitetura/segregação em Production;
- aprovação humana explícita de Production;
- evidências sem secrets/payloads sensíveis.

### Revisão e CI

```text
PR técnica                    = #112 = MERGED
Production/main SHA           = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
Foundation CI                 = 32925652721 = success
Moventra Jobs Contract        = 32925652826 = success
Moventra CI                   = 32925652778 = success
Production Promotion          = 32925970284 = success
```

### Migrations Production

```text
0015_outbox.sql checksum = d04165f94f2d3f073754d4b45f12fde66b0685abc418c197e35a75ee9303f845
0016_jobs.sql checksum   = 1c3f6681dd17ae39d5720396b661cd5d4691168af9c55c8b8f92f0e0b753188e
migration history        = 1–16 contiguous
backup branch            = pre-production-025-20260826 / br-autumn-paper-auh5hx3a
```

### Runtime Production

```text
Railway project          = moventra-tms-production
Railway service          = moventra-worker-production
Production deployment    = a6e55b5d-7807-460b-97e4-427f1e33dcc7 = SUCCESS
source                    = brunabarrichello/moventra-tms / main
runtime                   = exec node src/worker.js
region                    = iad / 1 replica
DB principal              = moventra_worker_app_production
handler                   = system.outbox_dispatch
```

O build de Production fixa e verifica o SHA canônico antes de gerar o artefato do worker. Secrets de banco e RabbitMQ permanecem apenas nos stores protegidos e nunca são registrados em documentação/log operacional.

### Smoke real Outbox → RabbitMQ Production

Evento sintético controlado:

```text
event id       = 01a03c25-0000-7000-8000-000000000026
event type     = system.production_smoke
attempt_count  = 1
claim_token    = NULL
claimed_at     = NULL
published_at   = 2026-08-26T03:37:16.877Z
```

Sequência observada:

```text
Outbox claim success
→ Messaging connect success
→ Messaging publish success
→ publisher confirm
→ Outbox mark_published success
→ system.outbox_dispatch execute success
```

Revalidação posterior manteve `attempt_count=1` e o mesmo `published_at`. Isso comprova ausência de uma segunda transição de publicação observada, sem alterar a garantia oficial **at-least-once**.

### Lease recovery Production

O schedule `system.outbox_dispatch` foi colocado de forma controlada em `running` com lease já expirado. O worker recuperou automaticamente e retornou para:

```text
status             = scheduled
attempt_count      = 0
lease_token        = NULL
leased_at          = NULL
lease_expires_at   = NULL
last_heartbeat_at  = NULL
last_completed_at  = advancing
```

### Rollback / restore / shutdown

Em Staging foram comprovados o rollback operacional sem down-migration, a durabilidade de evento enquanto o worker esteve indisponível, o restore da revisão aprovada, a recuperação do Outbox pendente e graceful SIGTERM do processo Node direto.

Uma repetição adicional de `redeploy` exclusivamente para repetir SIGTERM em Production foi bloqueada pelo controle de segurança do conector e não foi contornada. O comportamento já está coberto por testes/CI e por evidência operacional de Staging sobre o mesmo entrypoint/runtime aprovado.

## Riscos e hardenings não bloqueantes

O risco estrutural de usar Vercel serverless como loop contínuo foi resolvido: o worker possui runtime dedicado em Railway, separado da aplicação web.

Hardenings registrados para evolução:

- tornar a intenção TLS PostgreSQL explicitamente `verify-full` antes de futura mudança major do `pg`/`pg-connection-string`;
- ajustar `serviceVersion` da telemetria do worker para refletir o SHA de release em vez de `development`;
- evoluir o plano de hosting do worker para oferta com SLA/redundância compatíveis com Production empresarial quando a operação comercial exigir HA superior a uma réplica;
- manter shutdown da observabilidade fail-soft, sem permitir que exporter/SDK altere a correção do Job.

Nenhum desses itens altera a correção do scheduler, lease, Outbox Dispatcher, publisher confirm, isolamento tenant ou least privilege comprovados nesta fase.

## Fora do escopo

```text
026 — DLQ / reprocessamento administrativo
027 — Object Storage
UI administrativa de jobs
execução de código arbitrário
cron arbitrário fornecido por usuário
BYPASSRLS para worker
Redis/BullMQ como dependência obrigatória
exactly-once fim a fim
```

## Critérios de aceite

- [x] contratos internos de Jobs provider-neutral implementados;
- [x] migration PostgreSQL de jobs implementada;
- [x] tenant/system scope explícito e fisicamente segregado;
- [x] state machine e constraints implementadas;
- [x] claim `SKIP LOCKED` implementado;
- [x] lease + heartbeat + recovery implementados;
- [x] retry/backoff/jitter implementados;
- [x] Handler Registry controlado implementado;
- [x] worker runner com shutdown cooperativo implementado;
- [x] observabilidade de baixa cardinalidade implementada;
- [x] Outbox Dispatcher implementado;
- [x] publisher confirm antes de `markPublished` implementado;
- [x] application runtime e worker DB principals separados no contrato;
- [x] CI completo verde;
- [x] Staging com migration + worker dedicado evidenciado;
- [x] rollback/restore evidenciado;
- [x] Production protegida e evidenciada;
- [x] Issue #110 atualizada com evidências finais;
- [x] Confluence final sincronizado;
- [x] documentação final da 025 sincronizada.

## Próxima etapa após conclusão

A fase 025 está formalmente `EVIDENCED / CONCLUDED`.

A próxima etapa oficial é:

`026 — DLQ`

A 026 permanece `NOT ACTIVE` neste fechamento e deverá ser ativada em execução própria, preservando a governança e a sequência oficial do projeto.