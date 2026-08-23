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
009 — Empresa = ACTIVE / DEFINED
010 — Filial = NOT ACTIVE
G2 — Security Ready = NOT APPROVED
```

A linha canônica de continuidade está em:

```text
docs/foundation/IMPLEMENTATION-ORDER.md
```

## Banco e migrations

Provider oficial: Neon Postgres 18.6.

Foundation:

```text
db/migrations/0001_foundation.sql
db/validation/0001_foundation_validation.sql
```

Tenant:

```text
db/migrations/0002_tenant.sql
db/validation/0002_tenant_validation.sql
```

Runner:

```text
node scripts/db/migrate.mjs
```

Histórico/checksum:

```text
moventra_meta.schema_migrations
```

A migration 0001 permanece deliberadamente não-domínio.

A migration 0002 introduz somente:

```text
organization.tenants
```

A raiz Tenant não contém `tenant_id` apontando para si própria. Entidades das fases seguintes devem seguir o contrato tenant-aware de `DATA-CONVENTIONS.md` e ADR-0002.

Checksum de `0002_tenant.sql` aplicado em Neon `staging` e `main`:

```text
2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
```

## 008 — Tenant concluída

Implementação:

```text
src/modules/organization/tenant/tenant-domain.js
src/modules/organization/tenant/tenant-repository.js
```

Lifecycle:

```text
PROVISIONING
ACTIVE
SUSPENDED
CLOSING
CLOSED
```

A implementação usa transições explícitas e optimistic locking por `version`.

Evidência principal:

```text
PR #54 — implementação técnica
merge funcional = ca0259da26a9d57513d3aecd1c9f972413376b58

PR #55 — checkpoint canônico
main checkpoint = 96842a2dfd539ffac796a7f1bcfca2ad3227cc30
```

Quality gates:

```text
Foundation CI 32673556166 = success
Moventra CI 32673556165 = success
Foundation CI 32674044981 = success
Moventra CI 32674044984 = success
```

Neon staging/main, staging runtime e protected Production promotion foram validados. Em Production:

```text
project = moventra-tms
deployment = dpl_9fUgkq9WjNRY7berBmKkZCQes9s6
state = READY
GET /health = 200
GET /api/database-health = 200
runtime errors pós-deploy = none observed
```

Com isso:

```text
008 = CONCLUDED
```

## Fase ativa — 009 Empresa

A próxima unidade oficial é **009 — Empresa**.

Empresa representa uma organização jurídica/operacional pertencente a um único Tenant e deve nascer tenant-aware. A fase deve materializar somente a entidade Empresa, seu lifecycle, invariantes, migration/validation, persistência mínima e testes, sem antecipar Filial, Usuários, Memberships, Auth, RBAC, RLS ou Auditoria.

Diretrizes obrigatórias da 009:

```text
tenant_id UUID NOT NULL
PK UUID / uuidv7()
FK coerente para organization.tenants
business key tenant-aware
unicidades tenant-aware
timestamps TIMESTAMPTZ
optimistic locking quando houver mutação concorrente
lifecycle explícito
nenhuma entidade 010+
```

A especificação executiva está em:

```text
docs/implementation/009-empresa.md
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

A fase `007 — Convenções de Dados` está concluída.

Fontes:

- `docs/data/DATA-CONVENTIONS.md` — contrato canônico;
- `docs/implementation/007-convencoes-de-dados.md` — evidência e governança;
- `tests/architecture/data-conventions.test.js` — guardrails automatizados.

## Próxima transição

```text
008 = CONCLUDED
009 = ACTIVE / DEFINED
010 = NOT ACTIVE
```

Apenas após todos os quality gates da Empresa:

```text
009 = CONCLUDED
010 — Filial = ACTIVE
```

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD;
- Neon Postgres: banco PostgreSQL e branches de banco;
- Atlassian Rovo: Jira e Confluence quando utilizados como gestão/conhecimento;
- Vercel: deploy de staging e production;
- Google Drive: documentação e artefatos complementares;
- Sent: SMS, WhatsApp e RCS quando o domínio de comunicação for ativado.

> Plugins e conectores de engenharia não se tornam automaticamente dependências arquiteturais do TMS. Integrações de produto devem permanecer desacopladas por contratos/adapters.