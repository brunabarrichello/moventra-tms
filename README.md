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
007 — Convenções de Dados = ACTIVE
008 — Tenant = NOT ACTIVE
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

A **migration 0001 é deliberadamente não-domínio**. Ela não cria Tenant, Empresa, Filial, Usuários, Memberships, RBAC ou Auditoria. Essas entidades pertencem às fases 008–017 e somente poderão ser introduzidas quando suas etapas forem oficialmente ativadas.

No encerramento da fase 006, Neon `main` e `staging` possuem o baseline técnico 0001 e zero tabelas de negócio em `public`.

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

A produção foi validada na revisão:

```text
517f44e788d0f74488ba54a09b44f18284d2b117
```

com `/health = HTTP 200` e `/api/database-health = HTTP 200 / status=ready`.

## Convenções de dados — fase ativa

A próxima unidade oficial é `007 — Convenções de Dados`.

Fontes:

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/implementation/007-convencoes-de-dados.md`.

Tenant (008) não deve ser iniciado antes da conclusão da 007.

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD;
- Neon Postgres: banco PostgreSQL e branches de banco;
- Atlassian Rovo: Jira e Confluence quando utilizados como gestão/conhecimento;
- Vercel: deploy de staging e production;
- Google Drive: documentação e artefatos complementares;
- Sent: SMS, WhatsApp e RCS quando o domínio de comunicação for ativado.

> Plugins e conectores de engenharia não se tornam automaticamente dependências arquiteturais do TMS. Integrações de produto devem permanecer desacopladas por contratos/adapters.