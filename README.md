# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Arquitetura vigente

O Moventra TMS é uma plataforma SaaS empresarial multi-tenant, multiempresa e multifilial. A arquitetura inicial permanece um **monólito modular**, com segurança por padrão, LGPD, RBAC, escopo organizacional, RLS como defesa adicional, auditoria central, observabilidade, idempotência, Transactional Outbox, RabbitMQ provider-neutral e processamento assíncrono durável por Jobs.

## Estado oficial

```text
001 — Governança = CONCLUDED
002 — Arquitetura Base = CONCLUDED
003 — Ambientes = CONCLUDED
004 — CI/CD = CONCLUDED
005 — Secrets Management = CONCLUDED
006 — Banco Base = CONCLUDED
007 — Convenções de Dados = CONCLUDED
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = CONCLUDED
012 — Memberships = CONCLUDED
013 — Auth = CONCLUDED
014 — RBAC = CONCLUDED
015 — Escopo Organizacional = CONCLUDED
016 — RLS / Defesa adicional = CONCLUDED
017 — Auditoria Central = CONCLUDED
018 — Configurações = CONCLUDED
019 — Feature Flags = CONCLUDED
020 — Observabilidade Base = CONCLUDED
021 — Error Handling = CONCLUDED
022 — Idempotência = CONCLUDED
023 — Transactional Outbox = CONCLUDED
024 — Mensageria = CONCLUDED
025 — Jobs = EVIDENCED / CONCLUDED
026 — DLQ = ACTIVE / IMPLEMENTED / AWAITING RELEASE EVIDENCE
027+ = NOT ACTIVE

P0 pós-G2 — Runtime PostgreSQL least privilege = CONCLUDED
P1 pós-G2 — Pipeline integrado + release impact = CONCLUDED

G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

A linha canônica completa está em `docs/foundation/IMPLEMENTATION-ORDER.md`.

## Fundação de segurança e confiabilidade

```text
Tenant
└── Empresa
    └── Filial

User = identidade global/provider-agnostic
ExternalIdentity = provider + issuer + subject → User
Membership = User ↔ Tenant
RBAC = Permissions + Roles + Grants
Organizational Scope = Tenant / Empresa / Filial
RLS = defesa adicional transaction-local por Tenant
Audit Trail = tenant-scoped + append-only + minimização/redaction
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = rollout determinístico + targeting tenant-aware
Observability = OpenTelemetry + logs + traces + metrics
Error Handling = erros tipados + códigos estáveis + Problem Details
Idempotency = Idempotency-Key hash + fingerprint + stored result
Outbox = evento persistido atomicamente com a mutação de negócio
Messaging = ports provider-neutral + RabbitMQ, at-least-once, confirms e ack/nack
Jobs = PostgreSQL durable jobs + worker dedicado + lease/heartbeat/retry
DLQ = quarentena durável provider-neutral + state machine e reprocessamento governado
```

UUID vindo do cliente nunca é prova de autorização. Feature Flag nunca substitui Auth/RBAC/RLS. Observabilidade não substitui Audit. Mensageria, Jobs e DLQ preservam semântica **at-least-once** e exigem idempotência onde houver efeito externo.

## Banco e migrations

Provider oficial: **Neon PostgreSQL 18.6**.

Baseline aplicada e concluída em Production após a fase 025:

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

A fase ativa 026 já possui no repositório:

```text
db/migrations/0017_dlq.sql
```

`0017_dlq.sql` pertence à release 026 e não deve ser descrita como baseline Production concluída antes de Staging, rollback/restore, aprovação de Production e smoke final da fase.

## 024 — Mensageria

A fase 024 está concluída. O adapter de referência é RabbitMQ/AMQP 0-9-1 atrás de ports internos provider-neutral, com:

- publisher confirms;
- mensagens persistentes;
- manual ack/nack;
- prefetch controlado;
- envelope versionado;
- TLS obrigatório em Staging/Production;
- observabilidade de baixa cardinalidade;
- credenciais segregadas por ambiente.

Revisão funcional/runtime:

```text
93354cce0119cad56a39c29e4adf237043183da1
```

## 025 — Jobs e Outbox Dispatcher

A fase 025 está `EVIDENCED / CONCLUDED`.

```text
Issue                         = #110
PR técnica                    = #112
functional/runtime revision   = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
migration                     = 0016_jobs.sql
Worker Production project     = moventra-tms-production
Worker Production service     = moventra-worker-production
runtime                       = node src/worker.js
DB principal                  = moventra_worker_app_production
handler                       = system.outbox_dispatch
```

O finding pós-auditoria `MOV-P1-OBS-001` foi corrigido pela PR #114 e validado no Railway Production:

```text
hardening revision            = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
validated deployment          = 7c13314c-7f46-45b0-a9a7-6832ea039461
serviceVersion                = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
```

A precedência oficial da revision identity é:

```text
MOVENTRA_RELEASE_SHA
→ APP_VERSION
→ VERCEL_GIT_COMMIT_SHA
→ development
```

## 026 — DLQ

A fase 026 está ativa e possui fundação durável implementada no repositório a partir de:

```text
activation/governance = afff3c9e2dbb743e650c64def71d84763bc5db89
foundation revision   = cffa9d26f01af4c24484ac183b32716de9d51035
Issue                 = #115
migration             = 0017_dlq.sql
```

A conclusão da 026 continua condicionada a CI completo, PostgreSQL/RabbitMQ real, Staging, rollback/restore, aprovação humana explícita de Production, smoke e sincronização final da governança.

## CI e segurança

O baseline de engenharia exige:

- Foundation CI;
- Moventra CI;
- Moventra Jobs Contract;
- SCA/dependency vulnerability gate;
- SAST automatizado;
- secrets fora do repositório;
- least privilege no PostgreSQL e broker;
- release fail-closed;
- Production protegida por aprovação humana.

Vulnerabilidades de dependência e achados SAST de severidade alta/crítica são tratados como bloqueantes pela política de segurança versionada.

## Configuração

`.env.example` documenta apenas **nomes de contrato e defaults não sensíveis**. Valores reais de `DATABASE_URL`, `MESSAGING_RABBITMQ_URL`, tokens e demais credenciais ficam exclusivamente nos secret stores dos ambientes.

## Runtime e entrega

Mudanças runtime-impacting seguem:

```text
CI
→ immutable artifact
→ Staging
→ rollback/restore
→ protected Production approval
→ mesma revisão aprovada
→ revision identity
→ database readiness
→ runtime observability
→ Production evidence
```

`redeploy` de uma revisão Railway existente não promove automaticamente um novo SHA. Novas revisões de Worker devem ser implantadas explicitamente a partir do SHA aprovado e comprovadas novamente em `serviceVersion`.

## Atlassian/Jira

GitHub Issues e PRs permanecem a fonte oficial de execução técnica. O identificador Jira `MVT` está reservado, mas o projeto Jira não será materializado enquanto Jira não for formalmente promovido a fonte oficial de execução.

Conteúdo `MP-*` no Atlassian é histórico/legado e não substitui o estado canônico do Moventra atual.

## Continuidade

A próxima etapa em execução é **026 — DLQ**. A fase **027 — Object Storage** e posteriores permanecem `NOT ACTIVE` até a conclusão formal da 026.
