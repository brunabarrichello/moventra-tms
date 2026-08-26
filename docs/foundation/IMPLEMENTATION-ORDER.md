# Continuidade da Fundação — Linha Oficial de Implantação

Este documento é a **linha canônica de implantação do Moventra TMS**. Estado operacional e estado de artefatos em source control são tratados separadamente para impedir que código implementado seja confundido com promoção ou conclusão de fase.

## Sequência canônica

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS → Auditoria → Configurações → Feature Flags → Observabilidade → Error Handling → Idempotência → Transactional Outbox → Mensageria → Jobs → DLQ → Object Storage → demais domínios TMS**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidades e critérios documentados;
- **ACTIVE** — fase autorizada para execução;
- **PREPARED** — artefatos podem existir, porém a fase ainda não foi liberada;
- **IMPLEMENTED** — código/infraestrutura materializados;
- **EVIDENCED** — execução real observada e validada;
- **CONCLUDED** — implementação, validação, evidências e governança aprovadas;
- **FROZEN** — nenhuma progressão/promoção até fechamento do gate indicado;
- **NOT ACTIVE** — fase ainda não autorizada.

## Estado canônico vigente

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | governança e processo versionados |
| 002 — Arquitetura Base | **CONCLUDED** | monólito modular vigente |
| 003 — Ambientes | **CONCLUDED** | ambientes segregados |
| 004 — CI/CD | **CONCLUDED** | pipeline, artifact/release gates e proteção de Production |
| 005 — Secrets Management | **CONCLUDED** | stores segregados e least privilege |
| 006 — Banco Base | **CONCLUDED** | Neon PostgreSQL 18.6 + migration framework |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico e guardrails |
| 008 — Tenant | **CONCLUDED** | raiz SaaS materializada |
| 009 — Empresa | **CONCLUDED** | organização tenant-aware materializada |
| 010 — Filial | **CONCLUDED** | unidade tenant/company-aware materializada |
| 011 — Usuários | **CONCLUDED** | identidade global/provider-agnostic |
| 012 — Memberships | **CONCLUDED** | vínculo User ↔ Tenant |
| 013 — Auth | **CONCLUDED** | identidade externa e boundary de autenticação |
| 014 — RBAC | **CONCLUDED** | permissions + roles/grants tenant-scoped |
| 015 — Escopo Organizacional | **CONCLUDED** | Tenant/Empresa/Filial |
| 016 — RLS / Defesa adicional | **CONCLUDED** | contexto transacional + RLS tenant-aware |
| 017 — Auditoria Central | **CONCLUDED** | audit trail append-only/minimizado |
| 018 — Configurações | **CONCLUDED** | catálogo tipado + overrides hierárquicos |
| 019 — Feature Flags | **CONCLUDED** | targeting/rollout tenant-aware |
| 020 — Observabilidade Base | **CONCLUDED** | OpenTelemetry + logs/traces/métricas |
| 021 — Error Handling | **CONCLUDED** | erros tipados + Problem Details |
| 022 — Idempotência | **CONCLUDED** | claim/fingerprint/result tenant-aware |
| 023 — Transactional Outbox | **CONCLUDED** | intenção de publicação atômica |
| 024 — Mensageria | **CONCLUDED** | RabbitMQ atrás de portas provider-neutral, at-least-once, confirms e ack/nack |
| 025 — Jobs / Outbox Dispatcher | **EVIDENCED / CONCLUDED** | Jobs duráveis PostgreSQL + Worker Railway + dispatcher Outbox |
| 026 — DLQ | **ACTIVE / PARTIALLY EVIDENCED IN PRODUCTION / NOT CONCLUDED** | Batch 2 promovido e validado em Production; Batch 3 `jobs.failed_terminal → DLQ` em execução; governança/reprocess/admin ainda pendentes |
| 027+ | **NOT ACTIVE** | preservar a ordem oficial |

## Baseline 025 — identidade e runtime validado

```text
025 functional revision           = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
025 conclusion/docs revision      = d110360473f011ab2c586ad32006278063281f55
025 revision-identity hardening   = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
025 reconciliation main revision  = b3808c9e3ca3c6896e9ea32bcd96bbf7a5e15ceb
finding MOV-P1-OBS-001            = RESOLVED / PRODUCTION VALIDATED
worker runtime                    = Railway / moventra-worker-production
worker entrypoint                 = node src/worker.js
system handler                    = system.outbox_dispatch
messaging                         = RabbitMQ / AMQP 0-9-1 / TLS em staging+production
serviceVersion precedence         = MOVENTRA_RELEASE_SHA → APP_VERSION → VERCEL_GIT_COMMIT_SHA → development
```

## Batch 2 da 026 — Production evidenciada

```text
main revision                  = 9a0380cb9bd8600c345fc894a0d9d08fb7c62687
PR                             = #120
Foundation CI                  = 32938081748 SUCCESS
Moventra CI                    = 32938081754 SUCCESS
Jobs Contract                  = 32938081788 SUCCESS
Security CI                    = 32938081746 SUCCESS
DLQ Contract                   = 32938081753 SUCCESS
Release Gate / Staging         = 32938178973 SUCCESS
Rollback Drill                 = 32938286136 SUCCESS
Production Promotion           = 32938457243 SUCCESS
Production DB applied          = 18 migrations
Production DB max migration    = 0018
Production has 0017            = true
Production has 0018            = true
Railway deployment             = 5f95e401-5b12-4e36-a817-dead641a9acb
Railway serviceVersion         = 9a0380cb9bd8600c345fc894a0d9d08fb7c62687
```

A promoção do Batch 2 encerrou o antigo estado `AWAITING RELEASE EVIDENCE`, mas **não conclui a fase 026**. A Issue #115 continua aberta até que todos os critérios funcionais e operacionais de DLQ sejam satisfeitos.

## Banco — estado operacional de Production após o Batch 2 da 026

Provider: **Neon PostgreSQL 18.6**.

Aplicado em Production:

```text
0001_foundation.sql
0002_tenant.sql
0003_company.sql
0004_branch.sql
0005_user.sql
0006_membership.sql
0007_external_identity.sql
0008_rbac.sql
0009_organizational_scope.sql
0010_rls.sql
0011_audit.sql
0012_configuration.sql
0013_feature_flags.sql
0014_idempotency.sql
0015_outbox.sql
0016_jobs.sql
0017_dlq.sql
0018_dlq_worker_ingestion.sql
```

A migration `0019_dlq_job_terminal_capture.sql` pertence ao Batch 3 em desenvolvimento. Ela existe somente na branch da unidade de trabalho enquanto não passar por PR/CI/release; **não está autorizada em Production**.

## Boundary consolidado até 025

```text
User = identidade global
ExternalIdentity = identidade técnica global de provider
Membership = vínculo User ↔ Tenant
RBAC = permission catalog global + grants tenant-scoped
Organizational Scope = Tenant / Company / Branch
RLS = defesa adicional baseada em contexto transacional autorizado
Audit Trail = tenant-scoped, append-only, minimizado e redigido
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = targeting tenant-aware + coorte determinística
Observability = OpenTelemetry + structured logging + tracing + metrics
Error Handling = taxonomia tipada + códigos estáveis + Problem Details
Idempotency = claim/fingerprint/stored result transacional
Transactional Outbox = intenção de publicação atômica
Messaging = provider-neutral + RabbitMQ adapter + at-least-once
Jobs = filas duráveis em PostgreSQL + leases/heartbeat/retry + handler registry
Outbox Dispatcher = job de sistema dedicado no Worker Railway
```

## Fase ativa — 026 DLQ

A 026 está liberada exclusivamente para continuidade técnica sob `docs/implementation/026-dlq.md` e Issue #115.

Estado correto:

```text
ACTIVE / PARTIALLY EVIDENCED IN PRODUCTION / NOT CONCLUDED
```

### Batch 1 — foundation de quarentena

Materializado por `0017_dlq.sql`:

- `dlq.entries` tenant-scoped + RLS;
- `dlq.system_entries` fisicamente separado;
- source `message | job`;
- dedupe por origem;
- state machine de reprocessamento;
- optimistic `version`;
- limites de tentativa/claim;
- permissions `dlq.read`, `dlq.reprocess`, `dlq.resolve`, `dlq.discard`.

### Batch 2 — RabbitMQ DLX/DLQ + ingestão durável

Materializado e evidenciado em Production:

```text
primary consumer queue
→ nack(requeue=false)
→ RabbitMQ DLX
→ durable DLQ ingestion queue
→ dedicated Worker consumer
→ narrow SECURITY DEFINER capability
→ dlq.entries
```

Invariantes:

- Worker continua `NOBYPASSRLS`;
- sem leitura direta de `outbox.events`/DLQ tenant-scoped;
- Tenant/source derivados do Outbox autoritativo;
- ACK somente após persistência durável;
- retry/redelivery bounded;
- poison-loop protection;
- ingestão repetida deduplicada.

### Batch 3 — captura atômica de Jobs terminais

Unidade ativa atual:

```text
jobs.jobs / jobs.system_jobs
        ↓
transição para failed_terminal
        ↓
trigger PostgreSQL na mesma transação
        ↓
dlq.entries / dlq.system_entries
```

Regras:

- captura deve ser atômica com a transição terminal;
- tenant vem exclusivamente de `jobs.jobs.tenant_id`;
- system Job nunca usa `tenant_id NULL` em tabela tenant-scoped;
- raw Job payload não é copiado automaticamente ao snapshot DLQ;
- dedupe usa o contrato existente por `source_kind=job + source_id`;
- funções de trigger são `SECURITY DEFINER` com `PUBLIC EXECUTE` revogado;
- CI deve provar os dois escopos em PostgreSQL real.

## Pendências obrigatórias para concluir 026

1. concluir Batch 3 e evidenciar `jobs.failed_terminal → DLQ`;
2. reprocessamento governado de mensagens;
3. reprocessamento governado de Jobs;
4. APIs administrativas protegidas por RBAC/tenant scope;
5. `Idempotency-Key` nas mutações;
6. optimistic concurrency de decisões administrativas;
7. Audit before/after/ator/correlation das ações humanas;
8. testes de concorrência de operadores/workers;
9. observabilidade operacional com redução do ruído de polling vazio;
10. CI completo;
11. Staging;
12. rollback/restore;
13. aprovação humana explícita para qualquer nova Production;
14. smoke/evidência final;
15. documentação/Issue/Confluence sincronizados;
16. somente então `026 = EVIDENCED / CONCLUDED`.

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready   = APPROVED / REVALIDATED AFTER P0 + P1
G3+                   = NOT REACHED
```

## Regras de progressão

- `027 — Object Storage` permanece **NOT ACTIVE** até 026 ser `EVIDENCED / CONCLUDED`;
- nenhuma aprovação de Production pode ser inferida da ativação documental ou de uma promoção anterior;
- nenhuma migration em Production pode ser aplicada fora do release gate aprovado;
- revisões de Worker devem usar SHA explicitamente selecionado e comprovar o mesmo SHA em `serviceVersion`;
- secrets nunca são versionados nem usados como evidência documental;
- documentos históricos preservam contexto, mas runtime/código + decisão vigente + evidência real têm precedência em caso de conflito.

## Próxima transição permitida

Prosseguir exclusivamente com a **fase 026 — DLQ**, concluindo primeiro o Batch 3 `jobs.failed_terminal → DLQ`; depois seguir para reprocessamento governado e superfícies administrativas mínimas. A fase 027 continua bloqueada.
