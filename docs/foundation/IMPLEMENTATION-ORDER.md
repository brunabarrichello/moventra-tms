# Continuidade da Fundação — Linha Oficial de Implantação

Este documento é a **linha canônica de implantação do Moventra TMS**. Estado operacional e estado de artefatos em source control são tratados separadamente para impedir que código preparado seja confundido com fase ativada ou promovida.

## Sequência canônica

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS → Auditoria → Configurações → Feature Flags → Observabilidade → Error Handling → Idempotência → Transactional Outbox → Mensageria → Jobs → DLQ → Object Storage → demais domínios TMS**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidades e critérios documentados;
- **ACTIVE** — fase autorizada para execução;
- **PREPARED** — artefatos podem existir, porém a fase não está liberada para promoção operacional;
- **IMPLEMENTED** — código/infraestrutura materializados;
- **EVIDENCED** — execução real observada e validada;
- **CONCLUDED** — implementação, validação, evidências e governança aprovadas;
- **FROZEN** — nenhuma progressão, promoção ou migration adicional até fechamento do gate indicado;
- **NOT ACTIVE** — fase ainda não autorizada.

## Estado canônico — baseline 025 pós-auditoria

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
| 026 — DLQ | **PREPARED / FROZEN / NOT RELEASED** | artefatos preparatórios entraram em source control antes do gate pós-auditoria; não promover nem aplicar migration 0017 até fechamento das correções 1–14 |
| 027+ | **NOT ACTIVE** | preservar a ordem oficial |

> **Regra de precedência:** o estado operacional acima prevalece sobre a mera existência de arquivo, migration ou código em `main`. Artefato preparado não autoriza release.

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready   = APPROVED / REVALIDATED AFTER P0 + P1
G3+                   = NOT REACHED
```

## Baseline 025 — identidade e runtime

```text
025 functional revision          = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
025 conclusion/docs revision     = d110360473f011ab2c586ad32006278063281f55
025 post-audit hardening revision= 3d0ac7864d784e9bd74046cd995fab5ca6321b15
finding MOV-P1-OBS-001           = RESOLVED / PRODUCTION VALIDATED
worker runtime                   = Railway / moventra-worker-production
worker entrypoint                = node src/worker.js
system handler                   = system.outbox_dispatch
messaging                        = RabbitMQ / AMQP 0-9-1 / TLS em staging+production
serviceVersion precedence        = MOVENTRA_RELEASE_SHA → APP_VERSION → VERCEL_GIT_COMMIT_SHA → development
```

A revisão funcional original da 025 continua histórica. A revisão `3d0ac786...` é hardening pós-auditoria e corrige a identidade observável do Worker sem alterar o contrato funcional de Jobs/Outbox.

## Banco — baseline operacional de Production

Provider: **Neon PostgreSQL 18.6**.

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

A migration `0017_dlq.sql` pode existir em source control como artefato **PREPARED**, porém **não faz parte da baseline operacional 025 e não deve ser aplicada em Production antes da liberação formal da 026**.

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

## Gate de reconciliação pós-auditoria antes da 026

A fase 026 não pode avançar operacionalmente até os itens abaixo estarem concluídos/evidenciados:

1. Revision Identity do Worker;
2. `IMPLEMENTATION-ORDER.md`;
3. `README.md`;
4. Confluence oficial;
5. `.env.example`;
6. resolução da PR #109;
7. CI completo;
8. smoke real em Production;
9. dependency vulnerability gate;
10. SAST inicial;
11. revisão de polling/idle do Worker;
12. ADR de postura de rede Neon;
13. saneamento/rotulagem do legado Atlassian `MP-*`;
14. decisão de materialização Jira `MVT`.

Durante este gate ficam proibidos:

- migration `0017_dlq.sql` em Production;
- promoção de runtime 026;
- alteração do estado operacional da 026 para `EVIDENCED`/`CONCLUDED`;
- início da fase 027.

## Regra de revision identity

Revisão funcional/runtime é registrada separadamente de revisões exclusivamente documentais. Commits documentais posteriores não reabrem gates funcionais. Para Worker Railway, promoção de uma nova revisão exige SHA explicitamente selecionado, build fail-closed e comprovação do mesmo SHA em `serviceVersion`.

## Próxima transição permitida

A baseline operacional vigente permanece **001–025 CONCLUDED**. A **026 — DLQ** está **PREPARED / FROZEN / NOT RELEASED** até fechamento formal do gate pós-auditoria 1–14. Somente então poderá retornar a `ACTIVE` e seguir os release gates próprios da fase.
