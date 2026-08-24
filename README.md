# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Aplicações previstas

- `moventra-web`
- `moventra-api`
- `moventra-worker`
- `moventra-driver`
- `moventra-portal`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial multi-tenant, multiempresa e multifilial, com RBAC, auditoria, rastreabilidade, segurança por padrão, LGPD, observabilidade, idempotência e isolamento de dados entre tenants.

A arquitetura inicial adota **monólito modular**, organizado por domínios e preparado para extração de serviços somente quando houver necessidade operacional e métricas reais.

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
011 — Usuários = ACTIVE / DEFINED
012 — Memberships = NOT ACTIVE
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
G2 — Security Ready = NOT APPROVED
```

A linha canônica de continuidade está em `docs/foundation/IMPLEMENTATION-ORDER.md`.

## Banco e migrations

Provider oficial: Neon PostgreSQL 18.6.

Migrations vigentes:

```text
db/migrations/0001_foundation.sql
db/migrations/0002_tenant.sql
db/migrations/0003_company.sql
db/migrations/0004_branch.sql
```

Validations correspondentes:

```text
db/validation/0001_foundation_validation.sql
db/validation/0002_tenant_validation.sql
db/validation/0003_company_validation.sql
db/validation/0004_branch_validation.sql
```

Histórico/checksum é controlado por `moventra_meta.schema_migrations` via `scripts/db/migrate.mjs`.

## Hierarquia organizacional concluída até a fase 010

```text
Tenant
└── Empresa
    └── Filial
```

### 008 — Tenant

`organization.tenants` é a raiz SaaS, com UUIDv7, lifecycle explícito, timezone/moeda padrão, timestamps e optimistic locking. Não possui `tenant_id` autorreferente.

### 009 — Empresa

`organization.companies` pertence a exatamente um Tenant e usa chaves/queries tenant-aware, business key única no Tenant e optimistic locking.

Revisão funcional concluída em Production:

```text
3a3980a88ee39f63985da8358d1d88b6faf0a526
```

### 010 — Filial

`organization.branches` pertence a uma Empresa no mesmo Tenant e reforça a coerência por FK composta:

```text
(tenant_id, company_id)
  -> organization.companies(tenant_id, id)
```

Contratos principais:

```text
UNIQUE (tenant_id, company_id, id)
UNIQUE (tenant_id, company_id, code)
no máximo uma headquarters por Empresa
lifecycle DRAFT / ACTIVE / INACTIVE / CLOSED
ativação exige Tenant e Empresa ACTIVE
optimistic locking
repository tenant+company-scoped
cross-tenant e cross-company guardrails
```

PR técnica:

```text
#61 — feat(branch): implement phase 010 tenant/company-aware branch
merge funcional = e165a42954aea5c211b3812b5f2e0b34a9b24ada
```

CI:

```text
Foundation CI 32679033828 = success
Moventra CI 32679033865 = success
```

Migration 0004 aplicada/validada em Neon Staging/Main:

```text
checksum = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
```

Production final:

```text
stable /health = 200
stable revision = e165a42954aea5c211b3812b5f2e0b34a9b24ada
stable /api/database-health = 200 / ready
runtime errors pós-promoção = none observed
rollback/restore = validated
```

Com isso:

```text
010 = CONCLUDED
```

## Fase ativa — 011 Usuários

A próxima unidade oficial é **011 — Usuários**.

### Princípio de identidade

A identidade de negócio do usuário deve ser global e provider-agnostic.

```text
User = identidade humana/de negócio canônica
Membership = vínculo User ↔ Tenant/Empresa/Filial (fase 012)
Auth = vínculo técnico com provider/credentials/subjects (fase 013)
```

Logo, a fase 011 não deve adicionar `tenant_id`, `company_id` ou `branch_id` ao User, nem armazenar password hash, session, OAuth/OIDC subject ou provider id.

Escopo esperado:

```text
identity.users
UUIDv7
email canônico/único
display name
locale/timezone opcionais
lifecycle explícito
timestamps
optimistic locking
migration/validation
domínio/repository/testes
nenhuma entidade 012+
```

A especificação executiva está em `docs/implementation/011-usuarios.md`.

## Runtime e entrega

A aplicação utiliza Node `22.x`, `pg`/node-postgres e Vercel Build Output API v3.

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

Gates humanos protegidos não devem ser contornados por deploy manual.

## Convenções e segurança

Fontes canônicas:

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/architecture/ADR-0002-tenant-isolation.md`;
- `docs/security/TENANCY-RBAC-AUDIT.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`.

## Próxima transição

```text
010 = CONCLUDED
011 = ACTIVE / DEFINED
012 = NOT ACTIVE
G2 = NOT APPROVED
```

Somente após todos os quality gates de Usuários:

```text
011 = CONCLUDED
012 — Memberships = ACTIVE
```

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD;
- Neon Postgres: banco PostgreSQL e branches de banco;
- Atlassian Rovo: gestão/conhecimento em Jira e Confluence;
- Vercel: deploy de Staging e Production;
- Google Drive: documentação e artefatos complementares;
- Sent: SMS, WhatsApp e RCS quando o domínio de comunicação for ativado.

> Plugins e conectores de engenharia não se tornam automaticamente dependências arquiteturais do TMS. Integrações de produto devem permanecer desacopladas por contratos/adapters.
