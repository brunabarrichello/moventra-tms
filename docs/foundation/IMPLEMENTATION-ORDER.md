# Continuidade da Fundação — Linha Oficial de Implantação

A linha oficial do Moventra TMS preserva a sequência canônica de implantação. Neste checkpoint, a fundação e segurança 001–017, os hardenings P0/P1 e a fase 018 estão concluídos; a fase 019 é a única etapa funcional ativa.

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
| 019 — Feature Flags | **ACTIVE / DEFINED** | rollout controlado por ambiente/tenant/empresa/filial/usuário/plano/contexto e percentual, sem substituir autorização |
| 020 — Observabilidade Base | **NOT ACTIVE** | depende da conclusão formal da 019 |
| 021+ | **NOT ACTIVE** | preservar ordem oficial |

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

G2 permanece aprovado. A ativação da 019 não altera o gate de segurança já evidenciado; novos artefatos devem continuar reutilizando Auth → Membership → RBAC → Organizational Scope → Tenant/RLS → operação → Audit.

## Revisões de segurança pós-G2

```text
P0 runtime least privilege revision = 8c17e8c2c101c6e5c3bda3c5870e86a9136d43a8
P1 functional/runtime revision      = 0a0ec943cc249e635d94267f386bb638228e11f7
P1 Production deployment            = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
P1 docs-only proof revision         = 4d96525ef825eda49fdb7c2199d3e5cc4e96102c
```

## Fase 018 — revisão funcional e release

```text
PR técnica                   = #90
functional/runtime revision  = 81b7edf3571aa5e3b37ce81c42ef6f4bf5311359
Moventra CI                  = 32848703847 = success
Foundation CI                = 32848703867 = success
Release Gate                 = 32848816381 = success
Rollback Drill               = 32848933076 = success
Production Promotion         = 32849065397 = success
Production deployment        = dpl_ELC7hjcG2rCCJY2mA4vGWwmuYZdT = READY
```

O environment protegido `production` foi aprovado externamente, com `prevent_self_review=true` e sem bypass. Revision identity, application health, database readiness e runtime observability foram validados.

## Banco — estado canônico após 018

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
```

Checksums canônicos:

```text
0002_tenant.sql               = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
0003_company.sql              = 149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
0004_branch.sql               = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
0005_user.sql                 = 11a1c01962f68e04b4519172f6526ee0646e13fdcec142ef4842ea3ea3db8f60
0006_membership.sql           = 1196de78f64408d34f3e6353a57e0d68b9d39a51fb4c31a3d2ad9d684985806c
0007_external_identity.sql    = 1fc9db5b61796d29e5b98b57231e5973a05758ff8b1bcef2b0c58ff80c4fa6b0
0008_rbac.sql                 = 9071eccc4f7e1a80f4f2ab27bee0e75d1dc84f9e5de52dc36645bce78ca0e6f1
0009_organizational_scope.sql = eb9a820934b70305a50bd30a1b3a01c9aca033387e0fea09543dd25eee2748af
0010_rls.sql                  = 4fbdc2268a390f0d103c2300e363dc927952bf5a6ae74009c4b26ed715cfc6c1
0011_audit.sql                = 5f982ae3894d48833f27d447d24d932ddb99c3a3d2e6cb13eb823d9d67c86fa9
0012_configuration.sql        = 4e31a90321a6480d00e2aa6b0d058c72f737241044c170db03e94eadb2f0eb5c
```

Neon:

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
Organizational Scope = Tenant / Company / Branch
RLS = defesa adicional baseada em contexto transacional autorizado
Audit Trail = tenant-scoped, append-only, minimizado e redigido
Configuration Definition = catálogo global tipado
Configuration Setting = override tenant/company/branch tenant-scoped
```

Entidades globais não recebem RLS tenant-based apenas por serem globais. Toda autorização crítica continua no backend; RLS não substitui Membership/RBAC/escopo.

## Regra de revision identity

A revisão funcional/runtime que conclui uma fase é registrada separadamente de revisões exclusivamente documentais. Commits documentais posteriores não reabrem o gate funcional nem exigem nova promoção de aplicação Production.

## Próxima transição oficial

A fase **018 — Configurações = CONCLUDED**. A fase **019 — Feature Flags = ACTIVE / DEFINED**, conforme `docs/implementation/019-feature-flags.md`. A 020 e todas as posteriores permanecem inativas até a conclusão formal da 019.