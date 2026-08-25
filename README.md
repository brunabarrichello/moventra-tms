# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial multi-tenant, multiempresa e multifilial, com monólito modular como arquitetura inicial, segurança por padrão, LGPD, observabilidade, idempotência, isolamento tenant-aware e autorização crítica no backend.

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
020 — Observabilidade Base = ACTIVE / DEFINED
021+ = NOT ACTIVE

P0 pós-G2 — Runtime PostgreSQL least privilege = CONCLUDED
P1 pós-G2 — Pipeline integrado + release impact = CONCLUDED

G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

A linha canônica e as regras de promoção estão em `docs/foundation/IMPLEMENTATION-ORDER.md`. Configurações está documentada em `docs/implementation/018-configuracoes.md`; Feature Flags em `docs/implementation/019-feature-flags.md`; Observabilidade Base em `docs/implementation/020-observabilidade-base.md`.

## Fundação organizacional e de segurança

```text
Tenant
└── Empresa
    └── Filial

User = identidade global/provider-agnostic
ExternalIdentity = provider + issuer + subject → User
Membership = User ↔ Tenant
RBAC = Permissions + Roles + Grants
Organizational Scope = Tenant / Empresa / Filial
RLS = defesa adicional por Tenant transaction-local
Audit Trail = tenant-scoped + append-only + redaction/minimização
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = rollout determinístico + targeting tenant-aware
```

`identity.users`, `identity.external_identities`, `security.permissions` e catálogos globais de plataforma permanecem globais ao SaaS. Vínculos, regras e grants organizacionais são tenant-scoped quando pertencem a um Tenant. UUID vindo do cliente nunca é prova de autorização. Feature Flag nunca substitui autenticação, RBAC, escopo organizacional, RLS ou regra de negócio.

## Banco e migrations vigentes

Provider oficial: Neon PostgreSQL 18.6.

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
```

Checksum funcional mais recente:

```text
0013_feature_flags.sql = 2a22ee5ca00b0f3b7515d8a4f82ca37c3e0c7b4286c73348da7e91dde18ccb19
```

Neon Staging e Main foram validados em PostgreSQL 18.6.

## Fase 018 — Configurações

Revisão funcional:

```text
revision              = 81b7edf3571aa5e3b37ce81c42ef6f4bf5311359
Production deployment = dpl_ELC7hjcG2rCCJY2mA4vGWwmuYZdT
state                 = READY
```

O domínio materializa:

```text
configuration.definitions      = catálogo global tipado
configuration.settings         = overrides Tenant/Empresa/Filial
configuration.setting_versions = histórico append-only tenant-scoped
```

Precedência efetiva: `BRANCH > COMPANY > TENANT > DEFINITION_DEFAULT`. RLS, RBAC, Organizational Scope, Audit, optimistic locking e runtime least privilege foram evidenciados em PostgreSQL real e Production.

## Fase 019 — Feature Flags

Revisão funcional:

```text
revision              = 1dd64edb27be2edb8d22187b1997a315952cff08
Production deployment = dpl_7ZMu3BuqtAFfRbPfVpmn2uUt5KcV
state                 = READY
```

O domínio materializa catálogo global de flags, políticas por ambiente, regras tenant-scoped para Tenant/Empresa/Filial/User/Plan e histórico append-only. O rollout percentual usa bucket determinístico versionado, com precedência `USER > BRANCH > COMPANY > TENANT > PLAN > ENVIRONMENT > DEFAULT`. RLS, RBAC, Organizational Scope, Audit, optimistic locking, runtime least privilege e isolamento cross-tenant foram evidenciados em PostgreSQL real e Production.

## Hardening pós-G2

P0 comprovou privilégios PostgreSQL de runtime com principal non-owner/NOBYPASSRLS.

P1 incorporou em Production o pipeline reutilizável:

```text
verified assertion
→ ExternalIdentity/User/Membership
→ RBAC
→ Organizational Scope
→ Tenant transaction/RLS
→ operação
→ Audit
```

Revisão funcional P1:

```text
revision              = 0a0ec943cc249e635d94267f386bb638228e11f7
Production deployment = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
state                 = READY
```

## Runtime e entrega

Cadeia oficial para mudanças runtime-impacting:

```text
CI
→ immutable prebuilt artifact
→ staging
→ rollback/restore
→ protected production approval
→ same artifact
→ revision identity
→ database readiness
→ runtime observability
→ production evidence
```

Gates humanos protegidos não podem ser contornados por deploy manual. Revisões exclusivamente documentais percorrem a classificação auditável, mas não alteram runtime.

## Continuidade

A fundação 001–017, os hardenings P0/P1 e as fases 018–019 estão concluídos. A próxima etapa oficial explicitamente ativada é **020 — Observabilidade Base**; a 021 e todas as posteriores permanecem inativas.