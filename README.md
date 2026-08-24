# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial multi-tenant, multiempresa e multifilial, com monólito modular como arquitetura inicial, segurança por padrão, LGPD, observabilidade, idempotência e isolamento tenant-aware.

## Estado oficial

```text
001 — Governança = CONCLUDED
002 — Arquitetura Base = CONCLUDED
003 — Ambientes = CONCLUDED
004 — CI/CD = CONCLUDED
005 — Secrets Management = CONCLUDED
006 — Banco Base = CONCLUDED
G1 — Foundation Ready = APPROVED
007 — Convenções de Dados = CONCLUDED
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = CONCLUDED
012 — Memberships = ACTIVE / DEFINED
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
G2 — Security Ready = NOT APPROVED
```

A linha canônica está em `docs/foundation/IMPLEMENTATION-ORDER.md`.

## Banco e migrations vigentes

Provider oficial: Neon PostgreSQL 18.6.

```text
db/migrations/0001_foundation.sql
db/migrations/0002_tenant.sql
db/migrations/0003_company.sql
db/migrations/0004_branch.sql
db/migrations/0005_user.sql
```

Checksums canônicos de domínio:

```text
0002_tenant.sql  = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
0003_company.sql = 149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
0004_branch.sql  = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
0005_user.sql    = 11a1c01962f68e04b4519172f6526ee0646e13fdcec142ef4842ea3ea3db8f60
```

## Hierarquia e identidade já concluídas

```text
Tenant
└── Empresa
    └── Filial

User = identidade global/provider-agnostic
```

`identity.users` não possui `tenant_id`, `company_id` ou `branch_id`; o vínculo com organização passa a ser responsabilidade explícita de Membership.

### 011 — Usuários concluída

PR técnica:

```text
#64 — feat(user): implement phase 011 global provider-agnostic user
merge funcional = 4e4c2c7d3e88d1676a1da52da0dc39d1c555467d
```

CI:

```text
Foundation CI 32680722912 = success
Moventra CI 32680722872 = success
```

Neon Staging/Main:

```text
identity.users = present
migration 0005 checksum = canonical
email unique global = validated
User sem tenant/company/branch = validated
smoke PENDING -> ACTIVE/version 2 + cleanup = success
```

Production final:

```text
deployment = dpl_3rvaEkC4PaRTGPCtqc55yijPfcQf
state = READY
stable /health = 200
stable revision = 4e4c2c7d3e88d1676a1da52da0dc39d1c555467d
stable /api/database-health = 200 / ready
runtime errors pós-promoção = none observed
```

Com isso:

```text
011 = CONCLUDED
```

## Fase ativa — 012 Memberships

Membership passa a materializar o vínculo **User ↔ Tenant** sem duplicar User por tenant e sem antecipar autenticação, RBAC ou escopo organizacional de Empresa/Filial.

Boundary obrigatório:

```text
User = identidade global
Membership = vínculo User ↔ Tenant
Auth = provider/subject/credenciais/sessão — fase 013
RBAC = papéis/permissões — fase 014
Company/Branch scope assignments = fase 015
```

A 012 deve nascer tenant-aware, com `tenant_id`, `user_id`, lifecycle explícito, optimistic locking, unicidade de um Membership por User/Tenant e queries sempre tenant-scoped.

A especificação executiva está em `docs/implementation/012-memberships.md`.

## Runtime e entrega

Cadeia oficial:

```text
CI
→ immutable prebuilt artifact
→ staging
→ rollback/restore
→ protected production approval
→ same artifact
→ revision identity
→ database readiness
→ production evidence
```

Gates humanos protegidos não podem ser contornados por deploy manual.

## Próxima transição

```text
011 = CONCLUDED
012 = ACTIVE / DEFINED
013 = NOT ACTIVE
G2 = NOT APPROVED
```

Somente após todos os quality gates de Memberships:

```text
012 = CONCLUDED
013 — Auth = ACTIVE / DEFINED
```
