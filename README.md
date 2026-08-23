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
008 — Tenant = ACTIVE / IMPLEMENTED
009 — Empresa = NOT ACTIVE
G2 — Security Ready = NOT APPROVED
```

`008 — Tenant` está implementada e parcialmente evidenciada, mas ainda não está `CONCLUDED`: falta a promoção protegida da aplicação em Production para a revisão mergeada e a consolidação final da governança.

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

A raiz Tenant não contém `tenant_id` apontando para si própria. Empresa, Filial, Usuários, Memberships, Auth, RBAC, RLS e Auditoria continuam pertencendo às fases seguintes.

A `0002_tenant.sql` foi aplicada e validada em Neon `staging` e `main` com checksum:

```text
2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
```

## Fase 008 — Tenant

Implementação:

```text
src/modules/organization/tenant/tenant-domain.js
src/modules/organization/tenant/tenant-repository.js
```

Lifecycle inicial:

```text
PROVISIONING
ACTIVE
SUSPENDED
CLOSING
CLOSED
```

A implementação usa transições explícitas e optimistic locking por `version`.

PR técnica:

```text
#54 — feat(tenant): implement phase 008 aggregate root
merge commit = ca0259da26a9d57513d3aecd1c9f972413376b58
```

Quality gates da revisão técnica:

```text
Foundation CI run 32673556166 = success
Moventra CI run 32673556165 = success
```

Staging Vercel já serve a revisão mergeada:

```text
/health = HTTP 200
version = ca0259da26a9d57513d3aecd1c9f972413376b58
```

A aplicação em Production ainda deve passar pelo gate protegido antes da promoção formal da fase 008.

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

Não é permitido substituir o gate protegido por deploy manual apenas para acelerar promoção de fase.

## Convenções de dados

A fase `007 — Convenções de Dados` está concluída.

Fontes:

- `docs/data/DATA-CONVENTIONS.md` — contrato canônico;
- `docs/implementation/007-convencoes-de-dados.md` — evidência e governança da fase;
- `tests/architecture/data-conventions.test.js` — guardrails automatizados.

## Próxima transição

Estado atual:

```text
008 = ACTIVE / IMPLEMENTED
009 = NOT ACTIVE
```

Próximo gate:

```text
protected Production promotion
→ revision identity
→ health/readiness
→ production evidence
→ 008 = CONCLUDED
→ 009 — Empresa = ACTIVE
```

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD;
- Neon Postgres: banco PostgreSQL e branches de banco;
- Atlassian Rovo: Jira e Confluence quando utilizados como gestão/conhecimento;
- Vercel: deploy de staging e production;
- Google Drive: documentação e artefatos complementares;
- Sent: SMS, WhatsApp e RCS quando o domínio de comunicação for ativado.

> Plugins e conectores de engenharia não se tornam automaticamente dependências arquiteturais do TMS. Integrações de produto devem permanecer desacopladas por contratos/adapters.