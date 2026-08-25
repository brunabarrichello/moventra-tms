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
018 — Configurações = ACTIVE / DEFINED

P0 pós-G2 — Runtime PostgreSQL least privilege = CONCLUDED
P1 pós-G2 — Pipeline integrado + release impact = CONCLUDED

G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

A linha canônica e as regras de promoção estão em `docs/foundation/IMPLEMENTATION-ORDER.md`. A fase 018 está especificada em `docs/implementation/018-configuracoes.md`.

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
```

`identity.users`, `identity.external_identities` e `security.permissions` permanecem globais ao SaaS. Vínculos e grants organizacionais são tenant-scoped. UUID vindo do cliente nunca é tratado como prova de autorização.

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
```

Checksums canônicos de 0006–0011:

```text
0006_membership.sql           = 1196de78f64408d34f3e6353a57e0d68b9d39a51fb4c31a3d2ad9d684985806c
0007_external_identity.sql    = 1fc9db5b61796d29e5b98b57231e5973a05758ff8b1bcef2b0c58ff80c4fa6b0
0008_rbac.sql                 = 9071eccc4f7e1a80f4f2ab27bee0e75d1dc84f9e5de52dc36645bce78ca0e6f1
0009_organizational_scope.sql = eb9a820934b70305a50bd30a1b3a01c9aca033387e0fea09543dd25eee2748af
0010_rls.sql                  = 4fbdc2268a390f0d103c2300e363dc927952bf5a6ae74009c4b26ed715cfc6c1
0011_audit.sql                = 5f982ae3894d48833f27d447d24d932ddb99c3a3d2e6cb13eb823d9d67c86fa9
```

Neon Staging e Main foram validados em PostgreSQL 18.6.

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

A revisão documental de prova `4d96525ef825eda49fdb7c2199d3e5cc4e96102c` foi classificada `documentation-only`; Staging, rollback/restore e Production foram pulados e não houve novo deployment Vercel.

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

A fundação 001–017 e os hardenings P0/P1 estão concluídos. A próxima etapa oficial explicitamente ativada é **018 — Configurações**; nenhuma etapa posterior está ativa.
