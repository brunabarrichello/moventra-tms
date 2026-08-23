# 006 — Banco Base

## Estado

`CONCLUDED`

Dependências satisfeitas:

```text
004 — CI/CD = CONCLUDED
005 — Secrets Management = CONCLUDED
```

Blockers:

```text
B006-01 = RESOLVED
B006-02 = RESOLVED
```

## Objetivo

Estabelecer a fundação PostgreSQL oficial do Moventra TMS, reproduzível por migrations, segregada por ambiente, integrada ao runtime e preparada para as fases seguintes sem antecipar entidades de negócio.

## Infraestrutura oficial

Provider: Neon Postgres.

```text
Project: moventra-tms
Project ID: shiny-mode-01639948
Region: aws-us-east-1
PostgreSQL: 18.6
Database: neondb
Server timezone: GMT
```

### Branches Neon permanentes

| Ambiente lógico | Branch Neon | Branch ID | Estado |
|---|---|---|---|
| production/base | `main` | `br-morning-glitter-au97suq4` | ready / baseline 0001 aplicado e validado |
| staging | `staging` | `br-rapid-math-au6j6xut` | ready / baseline 0001 aplicado e validado |
| development | `development` | `br-summer-cloud-aulfwdsv` | ready |

Não criar projeto Neon duplicado enquanto este permanecer como source of truth.

## Baseline 0001

A migration inicial foi corrigida antes de sua primeira promoção para impedir antecipação de entidades pertencentes às fases 008–017.

O baseline oficial cria exclusivamente metadados técnicos em `moventra_meta`:

- `moventra_meta.database_contract`;
- `moventra_meta.schema_migrations`.

Nenhuma tabela de aplicação existe em `public` ao encerrar a fase 006.

Migration canônica:

```text
version=1
name=0001_foundation.sql
checksum=465a15f85d98c7d81cb40bcd6ac902085eb017b99e8cc604dd279a53726c1efa
```

Verificação atual de `main` em 23/08/2026:

```text
PostgreSQL = 18.6
timezone = GMT
moventra_meta.schema_migrations = present
moventra_meta.database_contract = present
public base tables = 0
migration 0001 records = 1
```

A branch `staging` apresentou o mesmo contrato estrutural: duas tabelas técnicas, zero tabelas de aplicação em `public` e migration 0001 registrada.

## Framework de migrations

Runner oficial:

```text
node scripts/db/migrate.mjs
```

Controles implementados:

- SQL versionado e ordenado;
- SHA-256 por migration;
- histórico em `moventra_meta.schema_migrations`;
- falha se migration aplicada for alterada;
- transação por migration;
- advisory lock;
- reaplicação idempotente;
- validação SQL correspondente;
- `DATABASE_URL` nunca passada como argumento ou persistida;
- política de correção por forward-fix;
- restore/PITR reservado a incidentes que exijam recuperação de estado.

## Runtime PostgreSQL

A integração de runtime usa `pg`/node-postgres com pool e adapter isolado da camada de domínio.

Controles relevantes:

- Vercel Fluid Compute;
- pool conectado ao lifecycle da função;
- helper transacional com `BEGIN/COMMIT/ROLLBACK` e release garantido;
- domínio/core sem dependência de Neon ou Vercel;
- pooled connection em runtime;
- conexão administrativa segregada para migrations;
- readiness sanitizado sem host, usuário, database, senha ou connection string;
- Node `22.x` alinhado nos ambientes de deploy.

## Segregação de roles — B006-01 RESOLVED

Roles de autorização:

- production: `moventra_runtime_production` (`NOLOGIN`);
- staging: `moventra_runtime_staging` (`NOLOGIN`).

Principals de aplicação:

- production: `moventra_app_production`;
- staging: `moventra_app_staging`.

Validações de menor privilégio:

- `LOGIN = true` no principal;
- `SUPERUSER = false`;
- `CREATEDB = false`;
- `CREATEROLE = false`;
- `REPLICATION = false`;
- `BYPASSRLS = false`;
- `CONNECT = true`;
- `CREATE` no database = false;
- `USAGE` em `public` = true;
- `CREATE` em `public` = false;
- sem acesso a `moventra_meta` pela identidade de runtime;
- membership somente na respectiva role `moventra_runtime_*`.

DDL/migrations permanecem segregados das identidades de runtime.

## B006-02 — RESOLVED

### Staging

O antigo Project ID de staging foi descontinuado. O projeto canônico atual é:

```text
Vercel project: moventra-tms-staging
Project ID: prj_NYeCYXZur3CPG1sS1wC81ffKBkoU
Team: ALEBRU / team_3JTmWy5Z7vLfh2OqOwuFZp1G
```

Evidência operacional de encerramento da Issue #44:

```text
deployment=dpl_GixB4SgQBQpuh6cXm6rcJ82EV5wa
state=READY
target=production do projeto dedicado de staging
Node=22.x
/health=HTTP 200
/api/database-health=HTTP 200 / status=ready
rollback/restore=READY e alias restaurado
```

A `DATABASE_URL` de staging foi sincronizada pelo fluxo secret-safe sem exposição de valor.

### Production

Projeto canônico:

```text
Vercel project: moventra-tms
Project ID: prj_5qFenjyeGE1joaGomaNrUIRGSBQs
Team: ALEBRU / team_3JTmWy5Z7vLfh2OqOwuFZp1G
```

Revisão canônica promovida:

```text
517f44e788d0f74488ba54a09b44f18284d2b117
```

GitHub Actions `Moventra Production Promotion`, run `32662438316`, attempt `3`:

- preflight protegido = success;
- aprovação do environment = success;
- deploy do exato artefato prebuilt = success;
- revision identity = success;
- `Verify production database readiness` = success;
- production evidence = success.

Runtime production validado em 23/08/2026:

```text
alias=moventra-tms.vercel.app
/health=HTTP 200 / status=ok
/api/database-health=HTTP 200 / status=ready
version=517f44e788d0f74488ba54a09b44f18284d2b117
latest verified deployment=dpl_BYNAb5FiqBeJkWeHATKZXCmfa7m4
state=READY
```

Nenhuma senha, hash, prefixo, host de conexão ou `DATABASE_URL` foi persistido na documentação.

## Evidências de engenharia da fase

A fase incorporou e validou, entre outros, os seguintes marcos:

- PR #28 — framework de migrations + baseline não-domínio;
- PR #29 — adapter PostgreSQL de runtime + pool;
- PR #30 — lockfile e `npm ci`;
- PR #32 — readiness PostgreSQL sanitizado;
- PR #33 — readiness incluído no artefato imutável;
- PRs posteriores de hardening de staging/runtime e promotion gate;
- Issue #44 — materialização do novo staging e validação da `DATABASE_URL`, encerrada com health 200;
- Production Promotion run `32662438316` — cadeia protegida integralmente verde.

## Gate de conclusão

- [x] PostgreSQL/Neon oficial identificado e versionado;
- [x] framework de migrations reproduzível;
- [x] baseline 0001 validado em banco limpo e Neon;
- [x] promotion controlada para `main`;
- [x] staging alinhado ao baseline;
- [x] runtime PostgreSQL integrado;
- [x] dependências travadas;
- [x] roles de aplicação de menor privilégio;
- [x] identidade de migration segregada;
- [x] `DATABASE_URL` provisionada por ambiente sem versionamento;
- [x] readiness PostgreSQL sanitizado;
- [x] staging `/api/database-health = 200 / ready`;
- [x] production `/api/database-health = 200 / ready`;
- [x] revision identity preservada;
- [x] CI/CD cobre migrations, runtime e artefato imutável;
- [x] nenhuma entidade das fases posteriores antecipada.

## Promoção oficial

```text
005 = CONCLUDED
006 = CONCLUDED
B006-02 = RESOLVED
G1 = APPROVED
007 = ACTIVE
```

A próxima fase oficial é `007 — Convenções de Dados`.