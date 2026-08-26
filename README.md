# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial **multi-tenant, multiempresa e multifilial**, estruturada inicialmente como monólito modular, com segurança por padrão, LGPD, autorização crítica no backend, isolamento tenant-aware, auditoria, observabilidade, idempotência, integridade transacional e evolução controlada por gates.

## Estado oficial

```text
001–025 = CONCLUDED
026 — DLQ = ACTIVE / IMPLEMENTED / AWAITING RELEASE EVIDENCE
027+ = NOT ACTIVE

G1 — Foundation Ready = APPROVED
G2 — Security Ready   = APPROVED / REVALIDATED
```

A reconciliação pós-auditoria da baseline 025 foi concluída pela PR #118, integrada em `main` no commit `b3808c9e3ca3c6896e9ea32bcd96bbf7a5e15ceb`, com CI de `main` verde e Production ainda sem a migration `0017_dlq.sql` no momento do fechamento do gate.

A fase 026 está liberada para continuidade técnica, mas `ACTIVE / IMPLEMENTED` **não significa `CONCLUDED` nem autorização de Production**.

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
- fase `ACTIVE` não equivale a approval de Production.

## Runtime atual validado da baseline 025

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

O Worker usa principal PostgreSQL dedicado de menor privilégio. A identidade de revisão observável segue:

```text
MOVENTRA_RELEASE_SHA
→ APP_VERSION
→ VERCEL_GIT_COMMIT_SHA
→ development
```

Revisões relevantes:

```text
025 functional/runtime revision    = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
025 conclusion/docs revision       = d110360473f011ab2c586ad32006278063281f55
025 revision-identity hardening    = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
025 reconciliation main revision   = b3808c9e3ca3c6896e9ea32bcd96bbf7a5e15ceb
MOV-P1-OBS-001                     = RESOLVED / PRODUCTION VALIDATED
```

## Banco — Production no fechamento da reconciliação 025

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

Consulta executada após merge + CI de `main`:

```text
applied_migrations = 16
max_version        = 16
has_0017           = false
```

A migration `0017_dlq.sql` existe em source control como parte da implementação técnica da fase 026, porém **não estava aplicada em Production na ativação formal da fase**.

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
- capabilities estreitas `SECURITY DEFINER` para processamento cross-tenant sem `BYPASSRLS`;
- revision identity validada em Production;
- adaptive idle polling implementado e coberto por testes.

## Fase 026 — DLQ

**Estado:** `ACTIVE / IMPLEMENTED / AWAITING RELEASE EVIDENCE`.

A arquitetura da 026 trata DLQ como subsistema durável e auditável, e não apenas como fila opaca do broker. A implementação em source control deve ser validada através dos gates próprios da fase.

Documentação e issue:

- `docs/implementation/026-dlq.md`;
- GitHub Issue #115;
- `docs/governance/025-POST-AUDIT-CORRECTIONS.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`.

Para concluir 026 ainda são obrigatórios:

- migration/validation SQL;
- RLS/least privilege;
- state machine e concorrência segura;
- idempotência de reprocessamento;
- integração RabbitMQ DLX/DLQ real;
- APIs administrativas com RBAC/tenant scope;
- auditoria/observabilidade;
- CI completo;
- Staging;
- rollback/restore;
- **aprovação humana explícita para Production**;
- smoke/evidências de conclusão.

A fase 027 — Object Storage permanece `NOT ACTIVE`.

## Segurança e configuração

Secrets e credenciais reais nunca são versionados. `.env.example` contém apenas nomes de contrato com atribuições vazias; defaults não sensíveis são documentados em comentários ou definidos/validados no código. Staging e Production usam secret stores segregados, TLS e credenciais de menor privilégio.

O Security CI inclui:

```text
Dependency vulnerability gate = npm audit --audit-level=high --omit=dev
SAST                           = CodeQL JavaScript/TypeScript
```

## CI da reconciliação 025 em `main`

```text
Foundation CI          32935498433 = SUCCESS
Moventra CI            32935498446 = SUCCESS
Moventra Jobs Contract 32935498527 = SUCCESS
Moventra Security CI   32935498444 = SUCCESS
```

## CI/CD e gates de Production

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

Ativar uma fase em governança não substitui nenhum desses gates. Nenhuma migration ou nova revisão de runtime deve ser promovida diretamente a Production fora do fluxo aprovado.

Consulte `docs/foundation/IMPLEMENTATION-ORDER.md` para a linha canônica vigente.
