# Continuidade da Fundação — Linha Oficial de Implantação

Este documento é a linha canônica de implantação do Moventra TMS. Quando houver divergência entre documentação histórica e evidência executada, prevalece a combinação de código/runtime real, decisões vigentes, evidência executada e esta linha canônica reconciliada.

## Sequência oficial

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS/Defesa adicional → Auditoria → Configurações → Feature Flags → Observabilidade → Error Handling → Idempotência → Transactional Outbox → Mensageria → Jobs → DLQ → Object Storage → demais domínios TMS**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidade e critérios documentados;
- **ACTIVE** — etapa oficialmente autorizada para execução;
- **PREPARED** — artefato técnico existe, mas a etapa ainda não está concluída;
- **IMPLEMENTED** — código ou infraestrutura existem fisicamente;
- **EVIDENCED** — execução real foi observada e validada;
- **CONCLUDED** — implementação, validação, evidência e governança do gate foram aprovadas.

## Estado canônico

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | governança e processo versionados |
| 002 — Arquitetura Base | **CONCLUDED** | monólito modular vigente |
| 003 — Ambientes | **CONCLUDED** | ambientes segregados |
| 004 — CI/CD | **CONCLUDED** | build-once, Staging, rollback/restore e Production protegida |
| 005 — Secrets Management | **CONCLUDED** | stores segregados e least privilege |
| 006 — Banco Base | **CONCLUDED** | Neon PostgreSQL 18.6 + migration framework |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico e guardrails |
| 008 — Tenant | **CONCLUDED** | raiz SaaS tenant-aware |
| 009 — Empresa | **CONCLUDED** | organização tenant-aware |
| 010 — Filial | **CONCLUDED** | unidade tenant/company-aware |
| 011 — Usuários | **CONCLUDED** | identidade global/provider-agnostic |
| 012 — Memberships | **CONCLUDED** | vínculo User ↔ Tenant |
| 013 — Auth | **CONCLUDED** | ExternalIdentity provider-agnostic |
| 014 — RBAC | **CONCLUDED** | permissions/roles/grants deny-by-default |
| 015 — Escopo Organizacional | **CONCLUDED** | Tenant/Empresa/Filial |
| 016 — RLS / Defesa adicional | **CONCLUDED** | contexto transaction-local e RLS tenant-aware |
| 017 — Auditoria Central | **CONCLUDED** | audit trail append-only, tenant-aware e redigido |
| 018 — Configurações | **CONCLUDED** | catálogo tipado + overrides hierárquicos |
| 019 — Feature Flags | **CONCLUDED** | targeting tenant-aware e rollout determinístico |
| 020 — Observabilidade Base | **CONCLUDED** | OpenTelemetry, logs, traces e métricas |
| 021 — Error Handling | **CONCLUDED** | erros tipados + Problem Details + sanitização |
| 022 — Idempotência | **CONCLUDED** | claim/fingerprint/stored result transacional |
| 023 — Transactional Outbox | **CONCLUDED** | intenção de publicação atômica com negócio/Audit |
| 024 — Mensageria | **CONCLUDED** | RabbitMQ provider-neutral, confirms, ack/nack e TLS |
| 025 — Jobs | **EVIDENCED / CONCLUDED** | durable jobs + worker dedicado + Outbox Dispatcher em Production |
| 026 — DLQ | **ACTIVE / IMPLEMENTED / AWAITING RELEASE EVIDENCE** | fundação durável materializada no código; release/evidência ainda pertencem ao gate 026 |
| 027+ | **NOT ACTIVE** | preservar ordem oficial |

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

## Revisões canônicas recentes

```text
023 functional/runtime       = b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
024 functional/runtime       = 93354cce0119cad56a39c29e4adf237043183da1
025 functional/runtime       = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
025 governance conclusion    = d110360473f011ab2c586ad32006278063281f55
025 revision hardening       = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
026 activation/governance    = afff3c9e2dbb743e650c64def71d84763bc5db89
026 foundation implementation= cffa9d26f01af4c24484ac183b32716de9d51035
```

A revisão funcional de uma fase permanece distinta de commits documentais ou hardenings posteriores. Um hardening não reescreve a revisão histórica que concluiu a funcionalidade.

## Fase 025 — Jobs — evidência consolidada

```text
Issue                         = #110
PR técnica                    = #112
functional/runtime revision   = d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
migration                     = 0016_jobs.sql
Worker Production project     = moventra-tms-production
Worker Production service     = moventra-worker-production
revision hardening PR         = #114
revision hardening SHA        = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
validated Railway deployment  = 7c13314c-7f46-45b0-a9a7-6832ea039461
runtime handler               = system.outbox_dispatch
runtime DB principal          = moventra_worker_app_production
```

A correção pós-auditoria `MOV-P1-OBS-001` está resolvida: `runtimeVersion()` prioriza `MOVENTRA_RELEASE_SHA`, e o Worker Production passou a registrar exatamente o SHA implantado em `serviceVersion`.

## Banco — baseline concluída até 025

Provider: Neon PostgreSQL 18.6.

A branch Production/main possui histórico aplicado contínuo **0001–0016**:

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

A fase 026 introduziu no repositório `0017_dlq.sql`. Enquanto a cadeia de release 026 não for concluída e evidenciada, `0017` deve ser tratada como **migration da fase ativa**, não como baseline Production concluída.

Neon canônico:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

## Boundary consolidado

```text
User = identidade global
ExternalIdentity = identidade técnica global de provider
Membership = vínculo User ↔ Tenant
RBAC = permission catalog global + grants tenant-scoped
Organizational Scope = Tenant / Empresa / Filial
RLS = defesa adicional baseada em contexto transacional autorizado
Audit Trail = tenant-scoped, append-only, minimizado e redigido
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = targeting tenant-aware + coorte determinística
Observability = OpenTelemetry + structured logs + traces + metrics
Error Handling = taxonomia tipada + códigos estáveis + Problem Details
Idempotency = claim/fingerprint/stored result transacional e tenant-aware
Transactional Outbox = intenção de publicação atômica e provider-neutral
Messaging = RabbitMQ atrás de ports provider-neutral, at-least-once
Jobs = PostgreSQL durable jobs + worker dedicado + lease/heartbeat/retry
DLQ = quarentena durável provider-neutral + governança de reprocessamento
```

## Configuração e release identity

A precedência oficial da identidade observável do runtime é:

```text
MOVENTRA_RELEASE_SHA
→ APP_VERSION
→ VERCEL_GIT_COMMIT_SHA
→ development
```

Variáveis de Messaging/Jobs/Outbox e release identity devem ser documentadas em `.env.example` apenas como contrato; valores sensíveis permanecem exclusivamente nos secret stores dos ambientes.

## Gates de segurança complementares

O baseline de CI deve incluir:

- SCA/dependency vulnerability gate com severidade **high/critical bloqueante**;
- SAST automatizado em PR/main, com achados de segurança de severidade alta/crítica bloqueantes;
- secrets nunca versionados;
- ações externas pinadas quando aplicável;
- evidências de CI preservadas sem payloads/secrets.

## Jira e Atlassian

Até decisão posterior, **GitHub Issues/PRs são a fonte oficial de execução técnica**. O identificador Jira `MVT` permanece reservado, porém o projeto Jira MVT não é requisito para continuidade enquanto Jira não for promovido formalmente a fonte de execução.

Conteúdo `MP-*` no Confluence pertence ao projeto histórico/legado e não é fonte canônica do Moventra atual.

## Próxima transição oficial

A fase **026 — DLQ** permanece a etapa ativa. A fase **027 — Object Storage** e todas as posteriores permanecem `NOT ACTIVE` até a conclusão formal, release protegida, evidência e sincronização de governança da 026.
