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

A arquitetura inicial adota **monólito modular**, organizado por domínios e preparado para extração de serviços somente quando houver necessidade operacional e métricas reais. A decisão está registrada em `docs/architecture/ADR-0001-modular-monolith.md`.

## Estado oficial

Em 23/08/2026:

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
010 — Filial = ACTIVE / DEFINED
011 — Usuários = NOT ACTIVE
G2 — Security Ready = NOT APPROVED
```

A linha canônica de continuidade está em:

```text
docs/foundation/IMPLEMENTATION-ORDER.md
```

## Banco e migrations

Provider oficial: Neon Postgres 18.6.

Migrations de domínio vigentes:

```text
db/migrations/0001_foundation.sql
db/migrations/0002_tenant.sql
db/migrations/0003_company.sql
```

Validations:

```text
db/validation/0001_foundation_validation.sql
db/validation/0002_tenant_validation.sql
db/validation/0003_company_validation.sql
```

Runner:

```text
node scripts/db/migrate.mjs
```

Histórico/checksum:

```text
moventra_meta.schema_migrations
```

## 008 — Tenant concluída

Tenant é a raiz SaaS e está materializado em:

```text
organization.tenants
```

Principais propriedades:

```text
UUIDv7
business key global estável
lifecycle explícito
TIMESTAMPTZ
optimistic locking
sem tenant_id autorreferente
```

A conclusão da 008 foi evidenciada em CI, Neon, Staging e Production protegida.

## 009 — Empresa concluída

Empresa é a organização jurídica/operacional tenant-scoped e está materializada em:

```text
organization.companies
```

Contratos principais:

```text
tenant_id UUID NOT NULL
FK -> organization.tenants(id)
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, code)
identificador fiscal jurisdicional opcional
DRAFT / ACTIVE / INACTIVE / CLOSED
optimistic locking
repository tenant-scoped
cross-tenant guardrails
```

PR técnica:

```text
#58 — feat(company): implement phase 009 tenant-aware company
merge funcional = 3a3980a88ee39f63985da8358d1d88b6faf0a526
```

CI:

```text
Foundation CI 32675529694 = success
Moventra CI 32675529687 = success
```

Migration 0003 aplicada/validada em Neon staging e main:

```text
checksum = 149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
```

Production final da revisão funcional:

```text
project = moventra-tms
deployment = dpl_GARNpGpTwdN3UxBfjpKmgngZHDF5
state = READY
revision = 3a3980a88ee39f63985da8358d1d88b6faf0a526
GET /health = 200
GET /api/database-health = 200
runtime errors pós-deploy = none observed
```

Com isso:

```text
009 = CONCLUDED
```

## Fase ativa — 010 Filial

A próxima unidade oficial é **010 — Filial**.

Filial deve representar uma unidade organizacional/operacional de uma Empresa dentro do mesmo Tenant. O modelo deve nascer tenant-aware e preservar coerência entre os três níveis:

```text
Tenant -> Empresa -> Filial
```

Diretrizes obrigatórias da 010:

```text
id UUID / uuidv7()
tenant_id UUID NOT NULL
company_id UUID NOT NULL
FK composta (tenant_id, company_id)
  -> organization.companies(tenant_id, id)
business key única por Empresa
lifecycle explícito
timezone/moeda como overrides opcionais
optimistic locking
queries tenant/company-scoped
cross-tenant e cross-company guardrails
nenhuma entidade 011+
```

A especificação executiva está em:

```text
docs/implementation/010-filial.md
```

## Runtime e entrega

A aplicação utiliza Node `22.x`, `pg`/node-postgres e Vercel Build Output API v3.

A cadeia oficial preserva o mesmo artefato entre staging e production:

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

## Convenções de dados

A fase `007 — Convenções de Dados` está concluída e continua obrigatória para todas as fases seguintes.

Fontes:

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/architecture/ADR-0002-tenant-isolation.md`;
- `tests/architecture/data-conventions.test.js`.

## Próxima transição

```text
009 = CONCLUDED
010 = ACTIVE / DEFINED
011 = NOT ACTIVE
```

Somente após todos os quality gates da Filial:

```text
010 = CONCLUDED
011 — Usuários = ACTIVE
```

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD;
- Neon Postgres: banco PostgreSQL e branches de banco;
- Atlassian Rovo: Jira e Confluence quando utilizados como gestão/conhecimento;
- Vercel: deploy de staging e production;
- Google Drive: documentação e artefatos complementares;
- Sent: SMS, WhatsApp e RCS quando o domínio de comunicação for ativado.

> Plugins e conectores de engenharia não se tornam automaticamente dependências arquiteturais do TMS. Integrações de produto devem permanecer desacopladas por contratos/adapters.
