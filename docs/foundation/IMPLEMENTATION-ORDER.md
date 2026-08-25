# Continuidade da Fundação — Linha Oficial de Implantação

A linha oficial do Moventra TMS preserva a sequência canônica de implantação. Neste checkpoint, a fundação e segurança 001–017, os hardenings P0/P1 e as fases 018–022 estão concluídos; a fase 023 — Transactional Outbox é a única etapa funcional ativa.

Sequência atual:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS/Defesa adicional → Auditoria → Configurações → Feature Flags → Observabilidade → Error Handling → Idempotência → Outbox → Mensageria → Jobs → DLQ → Object Storage → demais domínios TMS**

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
| 004 — CI/CD | **CONCLUDED** | build-once, immutable artifact, staging, rollback/restore e Production protegida |
| 005 — Secrets Management | **CONCLUDED** | stores segregados e least privilege |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6 e migration framework |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico e guardrails |
| 008 — Tenant | **CONCLUDED** | raiz SaaS materializada |
| 009 — Empresa | **CONCLUDED** | organização tenant-aware materializada |
| 010 — Filial | **CONCLUDED** | unidade tenant/company-aware materializada |
| 011 — Usuários | **CONCLUDED** | identidade global/provider-agnostic |
| 012 — Memberships | **CONCLUDED** | vínculo User ↔ Tenant materializado |
| 013 — Auth | **CONCLUDED** | ExternalIdentity provider-agnostic e resolução de identidade |
| 014 — RBAC | **CONCLUDED** | permissions globais, roles/grants tenant-scoped e deny-by-default |
| 015 — Escopo Organizacional | **CONCLUDED** | scopes Tenant/Empresa/Filial e assignments tenant-aware |
| 016 — RLS / Defesa adicional | **CONCLUDED** | contexto transaction-local e RLS tenant-aware |
| 017 — Auditoria Central | **CONCLUDED** | audit trail append-only, tenant-scoped e redigido |
| 018 — Configurações | **CONCLUDED** | catálogo tipado + overrides Tenant/Empresa/Filial + histórico + RLS/RBAC/Audit evidenciados em Production |
| 019 — Feature Flags | **CONCLUDED** | rollout determinístico e tenant-aware evidenciado em Production, sem substituir autorização |
| 020 — Observabilidade Base | **CONCLUDED** | OpenTelemetry vendor-neutral, logs estruturados, traces, métricas, correlation IDs, cardinalidade controlada e fail-safe evidenciados em Production |
| 021 — Error Handling | **CONCLUDED** | erros tipados, códigos estáveis, Problem Details, sanitização, anti-enumeração e retry classification evidenciados em Production |
| 022 — Idempotência | **CONCLUDED** | chave/fingerprint/stored result tenant-aware, transação PostgreSQL, RLS, concorrência e replay evidenciados em Production |
| 023 — Transactional Outbox | **ACTIVE / DEFINED** | estado de negócio + Audit + outbox event na mesma transação; provider-neutral |
| 024+ | **NOT ACTIVE** | preservar ordem oficial |

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

G2 permanece aprovado. A fase 023 deve continuar reutilizando Auth → Membership → RBAC → Organizational Scope → Tenant/RLS → Idempotência → operação → Audit, observabilidade minimizada e Error Handling seguro.

## Revisões de segurança pós-G2

```text
P0 runtime least privilege revision = 8c17e8c2c101c6e5c3bda3c5870e86a9136d43a8
P1 functional/runtime revision      = 0a0ec943cc249e635d94267f386bb638228e11f7
P1 Production deployment            = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
P1 docs-only proof revision         = 4d96525ef825eda49fdb7c2199d3e5cc4e96102c
```

## Fase 020 — revisão funcional e release

```text
Issue                         = #95
PR técnica                    = #96
functional/runtime revision   = 256e87991d73cea1dd4a385488708409cb22b0b2
Production Promotion          = 32876872400 = success
Production deployment         = dpl_2poo2Y8TnDaie3MM4NA2KzbXwBMu = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
```

## Fase 021 — revisão funcional e release

```text
Issue                         = #98
PR técnica                    = #99
functional/runtime revision   = e23cff77cd1af4b590fd3bf9ceac98e1cca4e5dc
source CI run                 = 32879964993 = success
Release Gate / Staging        = 32880111232 = success
Rollback Drill                = 32880277853 = success
Production Promotion          = 32880504603 = success
Production deployment         = dpl_8g1qdBw99RyZePkKJqm8CCCjGyJj = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
```

## Fase 022 — revisão funcional e release

```text
Issue                         = #101
PR técnica                    = #102
functional/runtime revision   = 028c9844005ced58806201bce9edce37b4ba2a01
Foundation CI (PR)            = 32884603521 = success
Moventra CI (PR)              = 32884603500 = success
source CI run                 = 32885005759 = success
Release Gate / Staging        = 32885144772 = success
Rollback Drill                = 32885320734 = success
Production Promotion          = 32885547785 = success
Production deployment         = dpl_8cVxgkFEaaQHh5spQiomrPgt14aK = READY
Production deployment URL     = moventra-31craqkfb-alebru.vercel.app
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = 495b6fc6cd29a558330bcc43bd4d8840cd9f4bd119728ca0850572ff94e3cbc8
production evidence artifact  = production-deployment-028c9844005ced58806201bce9edce37b4ba2a01
production evidence digest    = 497ed0c5b8904182c3f1b5d70a7f5a0ffd07b7603934d95b4819643e5172aeaa
```

A revisão 022 passou pela cadeia completa build-once → Staging → rollback/restore → Production protegida. A aprovação efetiva foi externa ao ator do workflow. Revision identity e database readiness passaram no deployment imutável e no alias estável. Logs de Production confirmaram `serviceVersion=028c9844005ced58806201bce9edce37b4ba2a01`, ambiente `production`, request/correlation IDs e trace/span IDs.

## Banco — estado canônico após 022

Provider: Neon PostgreSQL 18.6.

```text
0001_foundation.sql              = present
0002_tenant.sql                  = present
0003_company.sql                 = present
0004_branch.sql                  = present
0005_user.sql                    = present
0006_membership.sql              = present
0007_external_identity.sql       = present
0008_rbac.sql                    = present
0009_organizational_scope.sql    = present
0010_rls.sql                     = present
0011_audit.sql                   = present
0012_configuration.sql           = present
0013_feature_flags.sql           = present
0014_idempotency.sql             = present
```

Checksum canônico mais recente:

```text
0014_idempotency.sql = 5a1807d7b45ea49aae1e5da87e629ebedb5de7bd761620fc056d7c46ff86f41c
```

Neon:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

Em Main, `idempotency.records` está com RLS habilitado. `moventra_runtime_production` possui `USAGE` no schema e `SELECT/INSERT/UPDATE` na tabela, sem `CREATE`, `DELETE` ou `BYPASSRLS`; `moventra_app_production` herda a role de runtime.

## Boundary consolidado

```text
User = identidade global
ExternalIdentity = identidade técnica global de provider
Membership = vínculo User ↔ Tenant
RBAC = permission catalog global + grants tenant-scoped
Organizational Scope = Tenant / Company / Branch
RLS = defesa adicional baseada em contexto transacional autorizado
Audit Trail = tenant-scoped, append-only, minimizado e redigido
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = targeting tenant-aware com coorte determinística
Observability = OpenTelemetry + structured logging + tracing + metrics
Error Handling = taxonomia tipada + códigos estáveis + Problem Details
Idempotency = claim/fingerprint/stored result transacional e tenant-aware
Transactional Outbox = registro atômico da intenção de publicação, sem broker específico
```

## Regra de revision identity

A revisão funcional/runtime que conclui uma fase é registrada separadamente de revisões exclusivamente documentais. Commits documentais posteriores não reabrem o gate funcional nem exigem nova promoção de aplicação Production.

## Próxima transição oficial

A fase **022 — Idempotência = CONCLUDED**. A fase **023 — Transactional Outbox = ACTIVE / DEFINED**, conforme `docs/implementation/023-outbox.md` e Issue #103. A fase 024 — Mensageria e todas as posteriores permanecem inativas até a conclusão formal da 023.