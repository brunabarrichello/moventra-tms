# 025 — Jobs

## Estado

`ACTIVE / DEFINED`

A fase 024 — Mensageria foi concluída e evidenciada em Production para a revisão funcional `93354cce0119cad56a39c29e4adf237043183da1`. A fase 025 — Jobs é a etapa oficial ativa. A fase 026 — DLQ e posteriores permanecem `NOT ACTIVE`.

Issue oficial: #110.

## Objetivo

Introduzir o subsistema transversal de Jobs do Moventra TMS para execução assíncrona e recorrente com durabilidade, concorrência controlada, lease, retry/backoff, observabilidade e shutdown seguro, preservando o monólito modular e sem antecipar a governança administrativa de DLQ da fase 026.

A primeira integração funcional obrigatória será o **Outbox Dispatcher**, materializando o fluxo preparado nas fases 023 e 024:

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

A recomendação para a 025 é um framework interno de Jobs, provider-neutral no nível de aplicação, com persistência PostgreSQL e execução por worker do próprio monólito modular.

```text
Application / Domain
        │
        ├── agenda job por porta interna
        │
        ▼
JobScheduler Port
        │
        ▼
PostgreSQL Job Repository
        │
        ▼
Job Worker Runner
        │
        ▼
JobHandlerRegistry
        │
        ├── OutboxDispatcherJob
        └── futuros handlers controlados
```

Não introduzir Redis/BullMQ, Kubernetes Jobs ou SaaS externo apenas para cumprir esta fase. A decisão reduz dependências operacionais e reutiliza PostgreSQL 18, `FOR UPDATE SKIP LOCKED`, transações, observabilidade e padrões já consolidados.

A abstração deve permitir futura troca ou coexistência de runtime sem contaminar handlers de aplicação.

## Escopos de job

Jobs devem declarar explicitamente um dos escopos:

```text
tenant  -> pertence a um tenant e exige tenant_id
system  -> infraestrutura/plataforma, tenant_id ausente
```

Regras:

- job tenant-scoped nunca deriva `tenantId` de payload arbitrário;
- `tenant_id` é coluna estruturada, não somente metadata JSON;
- job system-scoped só pode usar tipos registrados como permitidos para sistema;
- nenhum handler pode elevar escopo organizacional implicitamente;
- jobs de domínio continuam sujeitos às invariantes, autorização e contexto transacional adequados.

## Estado e state machine

Estados canônicos:

```text
scheduled
  ↓ available_at alcançado
available
  ↓ claim/lease
running
  ├── success ───────────────→ succeeded
  ├── retryable failure ─────→ retry_scheduled
  ├── non-retryable/max ─────→ failed_terminal
  └── cancellation permitida → cancelled
```

Persistir somente estados úteis e auditáveis. `available` pode ser derivado de `status` + `available_at` em vez de duplicar estado físico se isso simplificar constraints.

Transições devem ser condicionais por lease/claim token para evitar conclusão por worker que perdeu propriedade do job.

## Modelo de dados proposto

Schema: `jobs`.

Tabela principal: `jobs.jobs`.

Campos mínimos:

```text
id                    uuid PK
tenant_id             uuid NULL
scope                  text NOT NULL
job_type               text NOT NULL
schema_version         integer NOT NULL
payload                jsonb NOT NULL
metadata               jsonb NOT NULL
status                 text NOT NULL
priority               smallint NOT NULL
available_at           timestamptz NOT NULL
attempt_count          integer NOT NULL
max_attempts           integer NOT NULL
lease_token            uuid NULL
leased_at              timestamptz NULL
lease_expires_at       timestamptz NULL
last_heartbeat_at      timestamptz NULL
last_error_code        text NULL
last_error_class       text NULL
completed_at           timestamptz NULL
cancelled_at           timestamptz NULL
created_at             timestamptz NOT NULL
updated_at             timestamptz NOT NULL
```

Regras estruturais:

- `scope='tenant'` implica `tenant_id IS NOT NULL`;
- `scope='system'` implica `tenant_id IS NULL`;
- `schema_version > 0`;
- `attempt_count >= 0`;
- `max_attempts` limitado;
- lease fields devem ser todos nulos ou coerentes com `status='running'`;
- erro persistido somente como código/classe sanitizados, nunca stack/raw secret;
- payload e metadata com limites de tamanho aplicados na aplicação e guardrails no banco quando viável;
- soft delete não é apropriado para job operacional: lifecycle é representado por estado, retenção posterior e auditoria.

Índices mínimos:

```text
(status, available_at, priority, created_at)
(lease_expires_at) WHERE status = 'running'
(tenant_id, status, available_at) WHERE tenant_id IS NOT NULL
(job_type, status, available_at)
```

Não criar unicidade global de payload. Dedupe/idempotência deve ser explícita por caso de uso.

## Claim e concorrência

Claim deve ser atômico e concorrente:

```sql
WITH eligible AS (
  SELECT id
    FROM jobs.jobs
   WHERE status IN ('scheduled', 'retry_scheduled')
     AND available_at <= clock_timestamp()
     AND (
       lease_token IS NULL
       OR lease_expires_at <= clock_timestamp()
     )
   ORDER BY priority DESC, available_at, created_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT $1
)
UPDATE jobs.jobs AS job
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

Workers concorrentes não podem receber o mesmo lease ativo.

## Lease e heartbeat

O worker deve renovar o lease somente quando ainda é proprietário do `lease_token`.

Heartbeat perdido ou worker morto não pode manter job preso indefinidamente. Após `lease_expires_at`, o job pode ser recuperado por outro worker conforme classificação e limite de tentativas.

Defaults iniciais recomendados:

```text
lease = 60 s
heartbeat = 20 s
batch = 25
concurrency = 5
idle poll = 1 s em runtime dedicado
```

Os valores devem ser configuráveis e limitados. Em runtime serverless request-driven, não iniciar loop infinito. A execução recorrente deve ocorrer em processo/entrypoint de worker apropriado.

## Retry e backoff

A 025 implementa política central de retry de Jobs.

Recomendação:

```text
delay = min(maxDelay, baseDelay * 2^(attempt-1)) + jitter
```

Com defaults conservadores:

```text
baseDelay = 1 s
maxDelay  = 5 min
maxAttempts = 10
jitter <= 20%
```

Jitter deve ser injetável/determinístico em testes.

Classificação usa Error Handling 021 e classificadores específicos do handler. Erro `non-retryable` ou job que excedeu `max_attempts` transita para `failed_terminal`.

A fase 026 tratará governança/reprocessamento de falhas terminais. A 025 apenas persiste o estado terminal de forma segura.

## Handler Registry

Handlers são registrados no bootstrap da aplicação:

```text
job_type -> handler
```

Regras:

- `job_type` controlado por catálogo da aplicação;
- não importar módulo/arquivo por string fornecida em payload;
- schema version validado antes da execução;
- payload validado por handler/contrato;
- handler recebe contexto estruturado (`jobId`, `tenantId`, attempt, correlation context), não a linha SQL crua;
- handler deve respeitar idempotência quando houver efeito externo.

## Outbox Dispatcher

Primeiro handler obrigatório:

```text
system.outbox_dispatch
```

Responsabilidade de uma execução:

1. `OutboxService.claimBatch()` com batch e claim TTL limitados;
2. para cada evento claimado, mapear via mapper 024;
3. publicar via `MessagingPublisher` 024;
4. somente após publisher confirm, chamar `OutboxService.markPublished()`;
5. se publish falhar, não marcar published;
6. permitir recuperação pelo TTL de claim da Outbox;
7. falha de um evento não pode apagar/invalidar outros eventos do batch;
8. resultados e métricas não expõem payload/tenant em labels.

O job recorrente pode ser agendado em intervalo curto, mas deve evitar duplicação explosiva. Recomenda-se um schedule singleton por ambiente, com chave lógica fixa e execução que agenda a próxima ocorrência somente de forma idempotente.

A 025 não altera a semântica at-least-once da 024 e não promete exactly-once.

## Scheduler

O scheduler deve suportar:

- one-shot (`availableAt`);
- delay relativo;
- recorrência interna controlada para jobs de sistema;
- cancelamento antes de execução quando permitido;
- chave de deduplicação opcional para schedules singleton.

Cron expression arbitrária fornecida por usuário não entra nesta fase. Se futuramente exposta, deverá possuir parser seguro, RBAC, timezone explícito e limites.

## Worker Runner

O runner deve:

- fazer claim bounded;
- respeitar concorrência configurada;
- executar handlers com timeout/cancel signal quando aplicável;
- heartbeat leases ativos;
- registrar sucesso/retry/falha terminal de forma condicional ao lease;
- aguardar com backoff quando não houver trabalho;
- reagir a `SIGTERM`/`SIGINT`;
- parar novos claims durante shutdown;
- aguardar jobs ativos até grace period;
- nunca executar busy-loop.

## Configuração

Variáveis propostas:

```text
JOBS_ENABLED=true|false
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

Todos os números devem ter min/max. Defaults de Production não devem ser alterados por input HTTP.

## Observabilidade

Métricas de baixa cardinalidade:

```text
jobs_operations_total{operation,outcome,job_type}
jobs_operation_duration_ms{operation,outcome,job_type}
jobs_active{job_type}
jobs_claim_batch_size{job_type}
```

`job_type` é catálogo controlado e de baixa cardinalidade.

Não usar como labels:

```text
jobId
tenantId
leaseToken
correlationId
payload
error message arbitrária
```

Logs/traces podem conter IDs sanitizados quando necessários para troubleshooting, sem payload ou secrets.

## Segurança

- backend-only execution;
- payload validado e limitado;
- nenhum secret persistido em payload/metadata;
- lease token criptograficamente aleatório;
- tenant/system scope validado por constraint e aplicação;
- RLS tenant-aware para jobs tenant-scoped;
- jobs system-scoped acessíveis somente por caminhos internos confiáveis;
- SQL parametrizado;
- errors sanitizados;
- nenhuma execução dinâmica de código;
- rate/concurrency limits por configuração;
- autorização futura de endpoints administrativos obrigatoriamente no backend.

## RLS e runtime least privilege

A migration deve conceder ao runtime somente os privilégios necessários para:

- `SELECT` de jobs elegíveis;
- `INSERT` de jobs permitidos;
- atualização das colunas operacionais de claim/heartbeat/status;

Sem `DELETE`, DDL ou alteração arbitrária de campos de segurança.

Para tenant jobs, políticas RLS devem usar o contexto transaction-local já consolidado. Operações system-scoped exigem caminho interno explícito e não podem usar bypass global de RLS como conveniência.

## Idempotência

A infraestrutura de Jobs oferece at-least-once execution quando lease expira após efeito parcial. Portanto:

- handlers com side effect externo devem usar Idempotência 022, semântica do provider ou dedupe do domínio;
- Outbox Dispatcher usa `eventId/messageId` estáveis e `markPublished` condicional;
- sucesso do handler e update de status não criam exactly-once fim a fim.

## Testes obrigatórios

Unitários:

- contratos e validação de payload/config;
- state machine;
- backoff/jitter;
- handler registry;
- graceful shutdown;
- timeout/cancellation;
- Outbox Dispatcher success/failure/partial batch;
- observabilidade sem alta cardinalidade.

Integração PostgreSQL:

- enqueue;
- claim concorrente com `SKIP LOCKED`;
- lease ownership;
- heartbeat;
- lease expiry/recovery;
- success;
- retry schedule;
- terminal failure;
- cancellation;
- tenant isolation/RLS;
- least privilege runtime.

Integração RabbitMQ:

- Outbox Dispatcher publica evento real via adapter 024;
- publisher confirm antecede `markPublished`;
- falha do broker mantém Outbox recuperável;
- reexecução preserva identidade lógica.

Arquiteturais:

- domínios não dependem do PostgreSQL Job Repository;
- handlers não importam runner internals;
- Jobs não implementa UI/DLQ administrativo 026;
- sem dependência obrigatória de Redis/Kubernetes;
- nenhum loop infinito em entrypoint HTTP/serverless.

Release:

- CI completo verde;
- migration aplicada de forma controlada;
- Staging executa job real e Outbox Dispatcher real;
- rollback/restore comprovado;
- Production exige gate humano explícito;
- evidência sem credenciais/payloads.

## Critérios de aceite

- [ ] contratos internos de Jobs provider-neutral;
- [ ] migration PostgreSQL de jobs;
- [ ] tenant/system scope explícito;
- [ ] state machine e constraints;
- [ ] claim `SKIP LOCKED`;
- [ ] lease + heartbeat + recovery;
- [ ] retry/backoff/jitter;
- [ ] handler registry controlado;
- [ ] worker runner com graceful shutdown;
- [ ] observabilidade de baixa cardinalidade;
- [ ] Outbox Dispatcher real;
- [ ] publisher confirm antes de `markPublished`;
- [ ] segurança/RLS/least privilege;
- [ ] testes unitários, integração e arquitetura verdes;
- [ ] CI verde;
- [ ] Staging evidenciado;
- [ ] rollback/restore;
- [ ] Production protegida e evidenciada;
- [ ] Issue #110 e Confluence sincronizados.

## Fora do escopo

```text
026 — DLQ / reprocessamento administrativo
027 — Object Storage
UI administrativa de jobs
execução de código arbitrário
cron arbitrário fornecido por usuário
Kubernetes orchestration
Redis/BullMQ como dependência obrigatória
exactly-once fim a fim
```

## Próxima etapa após conclusão

Somente depois da conclusão formal da 025 poderá ser ativada:

`026 — DLQ`
