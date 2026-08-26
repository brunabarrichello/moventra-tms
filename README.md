# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial **multi-tenant, multiempresa e multifilial**, estruturada inicialmente como monólito modular, com segurança por padrão, LGPD, autorização crítica no backend, isolamento tenant-aware, auditoria, observabilidade, idempotência, integridade transacional e evolução controlada por gates.

## Estado oficial — baseline operacional

```text
001–025 = CONCLUDED
026 — DLQ = PREPARED / FROZEN / NOT RELEASED durante reconciliação pós-auditoria
027+ = NOT ACTIVE

G1 — Foundation Ready = APPROVED
G2 — Security Ready   = APPROVED / REVALIDATED
```

A existência de artefatos da fase 026 em source control não equivale a ativação ou release. A baseline operacional de Production permanece na fase 025 até fechamento integral do gate pós-auditoria definido em `docs/foundation/IMPLEMENTATION-ORDER.md`.

## Fundação consolidada até a fase 025

```text
Tenant → Empresa → Filial
User + ExternalIdentity + Membership
RBAC + Organizational Scope + RLS
Audit Trail
Configuration + Feature Flags
OpenTelemetry + logs estruturados + traces + métricas
Error Handling / Problem Details
Idempotency
Transactional Outbox
Messaging provider-neutral / RabbitMQ
Durable Jobs / Worker Railway
System Outbox Dispatcher
```

Princípios invariantes:

- UUID recebido do cliente nunca prova autorização;
- toda autorização crítica é revalidada no backend;
- Feature Flag não substitui Auth/RBAC/RLS;
- observabilidade não substitui Audit;
- logs/auditoria devem respeitar minimização e LGPD;
- Outbox elimina a janela entre commit do negócio e intenção de publicação;
- Mensageria e Jobs trabalham com semântica **at-least-once** e exigem idempotência;
- nenhuma role de aplicação/worker deve usar `BYPASSRLS` para simplificar acesso;
- código preparado não autoriza migration/deploy de fase ainda não liberada.

## Runtime atual

### HTTP/API

```text
Runtime      = Vercel
Application  = moventra-tms
Node         = 22.x
Health       = /health
DB readiness = /api/database-health
```

### Worker assíncrono

```text
Runtime       = Railway
Service       = moventra-worker-production
Entrypoint    = node src/worker.js
Job handler   = system.outbox_dispatch
Persistence   = Neon PostgreSQL
Messaging     = RabbitMQ / AMQP 0-9-1
Delivery      = at-least-once
```

O Worker usa principal PostgreSQL dedicado de menor privilégio. O hardening pós-auditoria corrigiu a identidade de revisão observável para a precedência:

```text
MOVENTRA_RELEASE_SHA
→ APP_VERSION
→ VERCEL_GIT_COMMIT_SHA
→ development
```

Revisões relevantes da fase 025:

```text
functional/runtime revision     = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
conclusion/docs revision        = d110360473f011ab2c586ad32006278063281f55
post-audit hardening revision   = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
MOV-P1-OBS-001                  = RESOLVED / PRODUCTION VALIDATED
```

## Banco e migrations vigentes em Production

Provider oficial: **Neon PostgreSQL 18.6**.

```text
db/migrations/0001_foundation.sql
db/migrations/0002_tenant.sql
db/migrations/0003_company.sql
db/migrations/0004_branch.sql
db/migrations/0005_user.sql
db/migrations/0006_membership.sql
db/migrations/0007_external_identity.sql
db/migrations/0008_rbac.sql
db/migrations/0009_organizational_scope.sql
db/migrations/0010_rls.sql
db/migrations/0011_audit.sql
db/migrations/0012_configuration.sql
db/migrations/0013_feature_flags.sql
db/migrations/0014_idempotency.sql
db/migrations/0015_outbox.sql
db/migrations/0016_jobs.sql
```

`0017_dlq.sql`, quando presente no repositório, é artefato preparado da fase 026 e **não integra a baseline operacional 025** enquanto o gate pós-auditoria estiver aberto.

## Fases 024 e 025

### 024 — Mensageria

**Estado:** `CONCLUDED`.

Contrato provider-neutral com adapter RabbitMQ/AMQP 0-9-1, publisher confirms, mensagens persistentes, manual ack/nack, prefetch bounded, TLS obrigatório em Staging/Production e semântica at-least-once.

### 025 — Jobs e Outbox Dispatcher

**Estado:** `EVIDENCED / CONCLUDED`.

Inclui:

- filas duráveis em PostgreSQL;
- `jobs.jobs` tenant-scoped com RLS;
- `jobs.system_jobs` para jobs globais de plataforma;
- lease, heartbeat, timeout, retry e backoff;
- handler registry sem execução dinâmica arbitrária;
- Worker Railway contínuo, separado do runtime HTTP serverless;
- `system.outbox_dispatch` para publicação Outbox → RabbitMQ;
- capabilities estreitas `SECURITY DEFINER` para processamento cross-tenant sem `BYPASSRLS`.

Documentação principal:

- `docs/implementation/024-mensageria.md`;
- `docs/implementation/025-jobs.md`;
- `docs/implementation/025-post-audit-reconciliation.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`.

## Segurança e configuração

Secrets e credenciais reais nunca são versionados. `.env.example` contém somente o **contrato de nomes/configurações** e defaults não sensíveis. Staging e Production devem usar stores de secrets segregados, TLS e credenciais de menor privilégio.

## CI/CD

Mudanças runtime-impacting seguem a cadeia controlada:

```text
CI
→ artifact/revision validada
→ Staging
→ rollback/restore quando aplicável
→ approval humano protegido de Production
→ deployment
→ revision identity
→ readiness/smoke
→ evidência
```

Mudanças documentais não promovem runtime. Uma revisão de Worker Railway nova deve ser selecionada explicitamente por SHA; `redeploy` de deployment antigo não é mecanismo de promoção de revisão Git.

## Reconciliação antes da fase 026

Antes de qualquer promoção operacional de DLQ devem estar concluídos os 14 itens pós-auditoria: revision identity, fontes canônicas, Confluence, contrato de configuração, PR #109, CI, smoke Production, dependency scanning, SAST, polling do Worker, ADR Neon, legado Atlassian e decisão Jira MVT.

Até esse gate fechar:

```text
Production schema = 0001–0016
Production runtime = baseline 025
026 migration/deploy = BLOCKED
027+ = NOT ACTIVE
```

Consulte `docs/foundation/IMPLEMENTATION-ORDER.md` para a linha canônica completa.
