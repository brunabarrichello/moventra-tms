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

## Estado oficial da fundação

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
008 — Tenant = ACTIVE
009 — Empresa = NOT ACTIVE
G2 — Security Ready = NOT APPROVED
```

A linha canônica de continuidade está em:

```text
docs/foundation/IMPLEMENTATION-ORDER.md
```

## Banco base

Provider oficial: Neon Postgres 18.6.

- Migration: `db/migrations/0001_foundation.sql`;
- Validação: `db/validation/0001_foundation_validation.sql`;
- Runner: `node scripts/db/migrate.mjs`;
- histórico/checksum: `moventra_meta.schema_migrations`;
- contrato técnico: `moventra_meta.database_contract`.

A **migration 0001 é deliberadamente não-domínio**. Ela não cria Tenant, Empresa, Filial, Usuários, Memberships, RBAC ou Auditoria.

A fase 008 está autorizada, mas isso **não** significa que Tenant já exista fisicamente no banco. Até a migration da 008 ser implementada e validada, Neon `main` e `staging` continuam apenas com o baseline técnico 0001.

## Runtime e entrega

A aplicação foundation atual utiliza Node `22.x`, `pg`/node-postgres e Vercel Build Output API v3.

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

A produção da fundação foi validada na revisão:

```text
517f44e788d0f74488ba54a09b44f18284d2b117
```

com `/health = HTTP 200` e `/api/database-health = HTTP 200 / status=ready`.

## Convenções de dados

A fase `007 — Convenções de Dados` está concluída.

Fontes:

- `docs/data/DATA-CONVENTIONS.md` — contrato canônico;
- `docs/implementation/007-convencoes-de-dados.md` — evidência e governança da fase;
- `tests/architecture/data-conventions.test.js` — guardrails automatizados.

Evidência de implementação da 007:

```text
PR #51
merge commit = 46e08ce5cefe2c5d3df9eb89bcaee096dc9f9fa5
Foundation CI run = 32672159870 / success
Moventra CI run = 32672159907 / success
```

## Fase ativa — 008 Tenant

A próxima unidade oficial é `008 — Tenant`.

A 008 deve materializar somente o agregado raiz SaaS e seus invariantes, obedecendo `DATA-CONVENTIONS.md`, ADR-0002 e a linha oficial de implantação. Empresa (009), Filial (010), Usuários (011), Memberships (012), Auth (013), RBAC (014), Escopo Organizacional (015), RLS (016) e Auditoria (017) não devem ser antecipados.

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD;
- Neon Postgres: banco PostgreSQL e branches de banco;
- Atlassian Rovo: Jira e Confluence quando utilizados como gestão/conhecimento;
- Vercel: deploy de staging e production;
- Google Drive: documentação e artefatos complementares;
- Sent: SMS, WhatsApp e RCS quando o domínio de comunicação for ativado.

> Plugins e conectores de engenharia não se tornam automaticamente dependências arquiteturais do TMS. Integrações de produto devem permanecer desacopladas por contratos/adapters.