# Continuidade da Fundação — Linha Oficial de Implantação

A fundação do Moventra TMS segue esta sequência canônica:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS/Defesa adicional → Auditoria → Configurações**

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
| 001 — Governança | **CONCLUDED** | governança, histórico e processo de mudança versionados |
| 002 — Arquitetura Base | **CONCLUDED** | monólito modular vigente |
| 003 — Ambientes | **CONCLUDED** | ambientes segregados |
| 004 — CI/CD | **CONCLUDED** | build-once, immutable artifact, staging, rollback/restore, Production protegida e revision identity validados |
| 005 — Secrets Management | **CONCLUDED** | stores segregados e least privilege |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, migration framework e runtime least privilege |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico e guardrails |
| 008 — Tenant | **CONCLUDED** | raiz SaaS materializada |
| 009 — Empresa | **CONCLUDED** | organização tenant-aware materializada |
| 010 — Filial | **CONCLUDED** | unidade tenant/company-aware materializada |
| 011 — Usuários | **CONCLUDED** | identidade global/provider-agnostic materializada |
| 012 — Memberships | **CONCLUDED** | vínculo User ↔ Tenant tenant-scoped materializado e evidenciado |
| 013 — Auth | **CONCLUDED** | ExternalIdentity provider-agnostic e resolução User/Membership implementadas |
| 014 — RBAC | **CONCLUDED** | permissions globais, roles/grants tenant-scoped e autorização backend deny-by-default |
| 015 — Escopo Organizacional | **CONCLUDED** | escopos Tenant/Empresa/Filial e assignments tenant-aware materializados |
| 016 — RLS / Defesa adicional | **CONCLUDED** | contexto transacional e RLS aplicados às estruturas tenant-scoped |
| 017 — Auditoria Central | **CONCLUDED** | audit trail tenant-scoped, append-only, RLS e redaction/minimização validados |
| 018 — Configurações | **ACTIVE / DEFINED** | resolução hierárquica Tenant → Empresa → Filial, definições tipadas, overrides tenant-aware, RLS/RBAC/Audit e proteção de secrets definidos em `docs/implementation/018-configuracoes.md` |

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

`G2` permanece aprovado. O P0 comprovou acesso PostgreSQL least-privilege por principal non-owner/NOBYPASSRLS. O P1 pós-G2 integrou e provou o pipeline Auth → Membership → RBAC → Organizational Scope → Tenant/RLS → operação → Audit e classificou impacto de release para que alterações exclusivamente documentais não promovam runtime.

## Revisões de segurança pós-G2

```text
P0 runtime least privilege revision = 8c17e8c2c101c6e5c3bda3c5870e86a9136d43a8
P1 functional/runtime revision      = 0a0ec943cc249e635d94267f386bb638228e11f7
P1 Production deployment            = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
P1 docs-only proof revision         = 4d96525ef825eda49fdb7c2199d3e5cc4e96102c
```

A revisão docs-only foi classificada com `requires_release=false`; Staging, rollback/restore, preflight e Production deployment foram pulados e nenhuma nova implantação Vercel foi criada.

## Banco — estado canônico antes da 018

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
```

Neon:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

## Boundary de segurança consolidado

```text
User = identidade global
ExternalIdentity = identidade técnica global de provider
Membership = vínculo User ↔ Tenant
RBAC = permission catalog global + grants tenant-scoped
Organizational Scope = Tenant / Company / Branch
RLS = defesa adicional baseada em contexto transacional autorizado
Audit Trail = tenant-scoped, append-only, minimizado e redigido
```

Entidades globais (`identity.users`, `identity.external_identities`, `security.permissions`) não recebem RLS tenant-based. Toda autorização crítica continua obrigatória no backend; RLS não substitui Membership/RBAC/escopo de domínio.

## Regra de revision identity

A revisão funcional/runtime que conclui uma fase é registrada separadamente de revisões exclusivamente documentais. Commits documentais posteriores não reabrem o gate funcional nem exigem nova promoção de aplicação Production.

## Próxima transição oficial

A sequência fundacional 001–017 e os hardenings pós-G2 P0/P1 estão concluídos. A **018 — Configurações** está explicitamente definida e ativada como próxima etapa oficial. Nenhuma etapa posterior à 018 está ativa.
