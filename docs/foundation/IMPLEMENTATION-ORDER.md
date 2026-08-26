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
| 026 — DLQ | **ACTIVE / IMPLEMENTED / AWAITING RELEASE EVIDENCE** | gate pós-auditoria 1–14 concluído; artefatos técnicos já materializados; release próprio ainda pendente |
| 027+ | **NOT ACTIVE** | preservar a ordem oficial |

## Fechamento da reconciliação pós-auditoria 025

```text
Gate 1–14                  = CONCLUDED
PR de reconciliação        = #118
main revision reconciliada = b3808c9e3ca3c6896e9ea32bcd96bbf7a5e15ceb
Foundation CI              = 32935498433 SUCCESS
Moventra CI                = 32935498446 SUCCESS
Jobs Contract              = 32935498527 SUCCESS
Security CI                = 32935498444 SUCCESS
Production DB max migration= 0016
Production has 0017        = false
```

O histórico completo e a matriz dos 14 itens estão em `docs/governance/025-POST-AUDIT-CORRECTIONS.md`.

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready   = APPROVED / REVALIDATED AFTER P0 + P1
G3+                   = NOT REACHED
```

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

## Banco — estado operacional de Production no momento da ativação 026

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
```

A migration `0017_dlq.sql` existe em source control como parte da implementação técnica da fase 026, mas **não estava aplicada em Production no momento da ativação formal desta fase**.

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

A 026 está liberada para continuidade técnica sob o contrato de `docs/implementation/026-dlq.md` e issue #115.

Estado correto:

```text
ACTIVE / IMPLEMENTED / AWAITING RELEASE EVIDENCE
```

Isto significa:

- modelo/migration/código já existem em source control;
- a fase pode prosseguir com validação e release controlado;
- **não** significa `EVIDENCED` ou `CONCLUDED`;
- **não** autoriza promoção direta a Production.

Antes de concluir 026 permanecem obrigatórios:

1. validation SQL/RLS/least privilege;
2. state machine e concorrência de quarentena/reprocessamento;
3. idempotência de reprocessamento;
4. RabbitMQ DLX/DLQ real;
5. APIs administrativas protegidas por RBAC/tenant scope;
6. auditoria e observabilidade seguras;
7. CI completo;
8. Staging;
9. rollback/restore;
10. aprovação humana explícita para Production;
11. smoke/evidências após eventual Production;
12. documentação de conclusão e somente então liberação da fase 027.

## Regras de progressão

- `027 — Object Storage` permanece **NOT ACTIVE** até 026 ser `EVIDENCED / CONCLUDED`;
- nenhuma aprovação de Production pode ser inferida da ativação documental;
- nenhuma migration em Production pode ser aplicada fora do release gate aprovado;
- revisões de Worker devem usar SHA explicitamente selecionado e comprovar o mesmo SHA em `serviceVersion`;
- secrets nunca são versionados nem usados como evidência documental.

## Próxima transição permitida

Prosseguir exclusivamente com a **fase 026 — DLQ**, buscando `EVIDENCED / CONCLUDED`. A fase 027 continua bloqueada.
