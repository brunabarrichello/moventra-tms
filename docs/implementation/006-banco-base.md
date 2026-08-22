# 006 — Banco Base

## Estado

`ACTIVE / BLOCKED ON B006-02`

Dependência satisfeita: `005 — Secrets Management`.

## Objetivo

Estabelecer a fundação PostgreSQL oficial do Moventra TMS, reproduzível por migrations, segregada por ambiente e preparada para as fases seguintes sem antecipar entidades de negócio.

## Infraestrutura oficial

Provider: Neon Postgres.

Projeto: `moventra-tms`

Project ID: `shiny-mode-01639948`

Região: `aws-us-east-1`

PostgreSQL: `18.6`

Database inicial: `neondb`

Timezone do servidor: `GMT`.

### Branches Neon permanentes

| Ambiente lógico | Branch Neon | Branch ID | Estado |
|---|---|---|---|
| production/base | `main` | `br-morning-glitter-au97suq4` | ready / baseline 0001 aplicado |
| staging | `staging` | `br-rapid-math-au6j6xut` | ready / baseline 0001 aplicado |
| development | `development` | `br-summer-cloud-aulfwdsv` | ready |

Não criar projeto Neon duplicado enquanto este permanecer como source of truth.

## Baseline e correção P0

Ao ativar a 006 foi identificado que a antiga `db/migrations/0001_foundation.sql` antecipava tenants, companies, branches, users, memberships, RBAC e auditoria, pertencentes às fases 008–017. Como essa versão não havia sido aplicada no Neon oficial, ela foi corrigida antes da primeira promoção.

O baseline 0001 agora é estritamente não-domínio e cria somente metadados técnicos em `moventra_meta`. Testes arquiteturais e validation bloqueiam regressão dessa antecipação.

## Framework de migrations implementado

Runner: `node scripts/db/migrate.mjs`.

Características:

- migrations SQL versionadas e ordenadas;
- SHA-256 por migration;
- histórico em `moventra_meta.schema_migrations`;
- falha se uma migration aplicada for alterada;
- transação por migration;
- advisory lock transacional;
- reaplicação segura de migrations já registradas;
- `DATABASE_URL` nos ambientes reais e contrato `PG*` em contextos controlados de CI/administração;
- `DATABASE_URL` removida do ambiente do processo filho `psql` e nunca passada como argumento;
- validation SQL correspondente a cada migration;
- política de correção por forward-fix, com restore/PITR reservado a incidentes de estado.

## Evidências de CI e implementação

### PR #28 — framework e baseline

- Foundation CI #111 = success;
- Moventra CI #106 = success;
- PostgreSQL 18 limpo = migration aplicada;
- segunda execução = histórico idempotente;
- validation 0001 = success;
- lint, testes, security baseline, build imutável e CI evidence = success.

PR #28 foi squash-merged em `ee4a5a265efbcccc4b825d2eda272359b160238d`.

### PR #29 — runtime PostgreSQL

Foi integrado:

- `pg` (node-postgres);
- Vercel Fluid Compute;
- `attachDatabasePool`;
- adapter isolado em `src/infrastructure/database/postgres.js`;
- helper transacional com `BEGIN/COMMIT/ROLLBACK` e release garantido;
- domínio/core sem dependência de `pg`, Neon ou Vercel;
- pooled connection para runtime e conexão direta para migrations.

PR #29 foi squash-merged em `20bb82e9a82fa0a88d4670681ab0cebd05c17d05`.

### PR #30 — reprodutibilidade de dependências

- `package-lock.json` versionado;
- CI alterado para instalação travada por lockfile com `npm ci`;
- Foundation CI #117 = success;
- Moventra CI #112 = success;
- lint, testes, security baseline, runtime dependencies, migration contract, build e CI evidence = success.

PR #30 foi squash-merged em `992fd332185b97aed2407b440b5c3de664ad1823`.

### PR #32 — readiness PostgreSQL sanitizado

Foi criado um probe de runtime que retorna somente:

- `status=ready|unavailable`;
- `service=database`;
- revisão imutável servida.

O probe não retorna host, usuário, database, senha, versão do servidor ou `DATABASE_URL`. Falhas de configuração/conectividade resultam em HTTP 503.

### PR #33 — database health no artefato imutável

Foi identificado que o source do PR #32 ainda não entrava no Build Output API v3 canônico. O builder foi corrigido para empacotar `api/database-health.func`, suas dependências travadas e as rotas `/database-health` e `/api/database-health`.

Controles adicionados/reforçados:

- dependências instaladas por `npm ci` nos testes e no build;
- teste arquitetural exige as rotas e dependências do bundle;
- `build.sh` valida sintaxe e import da função PostgreSQL empacotada;
- repository contract exige os arquivos do database health e o builder Vercel.

Evidência final do PR #33:

- Foundation CI #126 = success;
- Moventra CI #121 = success;
- Repository contract = success;
- Tests = success;
- Lint = success;
- Security baseline = success;
- PostgreSQL runtime dependencies = success;
- PostgreSQL migration contract = success;
- Build immutable artifact = success;
- CI evidence = success.

PR #33 foi squash-merged em `ec86e2810d90f61d9a23dd3a2dd0d71caebcb3de`.

## Validação e promoção Neon

A migration 0001 foi inicialmente aplicada e validada em branch temporária Neon filha da `main`.

Validações executadas antes da promoção:

- PostgreSQL 18+ confirmado;
- `moventra_meta.schema_migrations` presente;
- `moventra_meta.database_contract` presente;
- contrato `Moventra TMS / moventra-tms / version 1` válido;
- migration 0001 registrada com checksum SHA-256 válido;
- somente 2 tabelas internas em `moventra_meta`;
- `public` sem tabelas de aplicação;
- nenhum schema ou tabela das fases 008+ criado;
- diff formal contra a `main` continha somente `moventra_meta` e seus dois objetos técnicos.

Após aprovação explícita, a migration `dbd7fa04-53d5-4f1e-90e8-740d33d819af` foi promovida para a branch Neon `main`. A branch temporária foi removida automaticamente pelo fluxo seguro.

### Registro canônico

- migration version: `1`;
- migration name: `0001_foundation.sql`;
- checksum: `465a15f85d98c7d81cb40bcd6ac902085eb017b99e8cc604dd279a53726c1efa`;
- applied by em `main`: `neondb_owner`.

Inventário de tabelas de fundação:

- `moventra_meta.database_contract`;
- `moventra_meta.schema_migrations`.

Nenhuma entidade de Tenant, Empresa, Filial, Usuários, Memberships, RBAC ou Auditoria foi criada.

### Alinhamento de staging

Durante a validação do runtime foi detectado que a branch Neon `staging` ainda não possuía o baseline 0001. O ambiente foi alinhado com o mesmo contrato e o mesmo checksum de `main`, sem introduzir entidade de negócio.

## Segregação de roles — B006-01 RESOLVED

Roles de autorização:

- production: `moventra_runtime_production` (`NOLOGIN`);
- staging: `moventra_runtime_staging` (`NOLOGIN`).

Principals de aplicação:

- production: `moventra_app_production`;
- staging: `moventra_app_staging`.

Os principals foram criados com `PASSWORD NULL`, deliberadamente sem gerar segredo durante a automação.

Validações de menor privilégio em ambos os ambientes:

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
- acesso a `moventra_meta` = false;
- membership somente na respectiva role `moventra_runtime_*`.

DDL/migrations permanecem segregados da identidade de runtime.

## Runtime e environments Vercel

Projetos oficiais:

| Ambiente | Projeto Vercel | Project ID |
|---|---|---|
| staging | `moventra-tms-staging` | `prj_4USELVoAr0FsHg2vBNGXws7hU22Q` |
| production | `moventra-tms` | `prj_5qFenjyeGE1joaGomaNrUIRGSBQs` |

O conector Vercel disponível permite consultar projetos, deployments e runtime, mas não expõe nem administra Environment Variables/Secrets. Portanto, a gravação de `DATABASE_URL` continua sendo uma operação administrativa externa ao conector.

### Evidência operacional de staging pós-PR #33

- novo deployment de staging = `READY`;
- alias canônico `/health` = HTTP 200;
- revisão servida = `ec86e2810d90f61d9a23dd3a2dd0d71caebcb3de`;
- `/database-health` = HTTP 503;
- payload sanitizado = `status=unavailable`, `service=database`, mesma revisão.

Essa evidência prova que source, CI, artefato e rota foram promovidos corretamente. O HTTP 503 é coerente com `moventra_app_staging` ainda sem senha e com `DATABASE_URL` ainda não provisionada no runtime.

## Blocker final B006-02 — credencial e `DATABASE_URL` por ambiente

O único blocker restante da fase é transformar os principals já segregados em credenciais operacionais e armazenar as respectivas connection strings pooled no secret store do Vercel.

Sequência obrigatória:

1. staging primeiro: definir senha forte para `moventra_app_staging` fora de logs/chat;
2. obter no Neon Console a pooled connection string para branch `staging`, role `moventra_app_staging`, database `neondb`;
3. configurar `DATABASE_URL` no projeto `moventra-tms-staging`, environment `Production`;
4. redeploy e validar `/database-health` = HTTP 200 / `ready`;
5. somente depois repetir o processo em production com branch `main`, role `moventra_app_production` e projeto `moventra-tms`;
6. validar production via `/database-health` sem revelar credenciais.

Não são necessários screenshots. A evidência final é o readiness operacional com a revisão correta.

Nunca registrar ou transmitir em documentação/chat:

- senha;
- `DATABASE_URL`;
- hash ou prefixo do segredo;
- connection string parcial;
- conteúdo de secret store.

## Decisões da fase

1. PostgreSQL/Neon é o banco transacional primário inicial do monólito modular.
2. O banco evolui exclusivamente por migrations versionadas e reproduzíveis.
3. Nenhuma credencial ou connection string real será versionada.
4. `DATABASE_URL` será resolvida por secret store por ambiente.
5. Migrations aplicadas são imutáveis; correções posteriores usam nova migration.
6. A política padrão de recuperação de schema é forward-fix; restore/PITR é reservado a incidentes que justifiquem recuperação de estado.
7. Alterações são testadas em branch temporária/ambiente não produtivo antes de aplicação em `main`.
8. Esta fase não cria entidades das fases posteriores.
9. Convenções detalhadas de dados permanecem reservadas à fase `007 — Convenções de Dados`.
10. Runtime e migration usam identidades segregadas por menor privilégio.
11. Health/readiness nunca expõe metadados de conexão ou material sensível.

## Trabalho ativo

- [x] identificar projeto Neon oficial existente;
- [x] inventariar PostgreSQL, região, database e branches;
- [x] corrigir migration que antecipava fases posteriores;
- [x] implementar framework SQL + `psql` com checksum/history/lock;
- [x] criar migration e validation 0001;
- [x] validar reconstrução em PostgreSQL 18 limpo no CI;
- [x] validar reaplicação idempotente;
- [x] validar migration em branch temporária Neon;
- [x] comparar formalmente o delta de schema;
- [x] promover migration 0001 para Neon `main` após aprovação explícita;
- [x] validar `main` após promoção;
- [x] alinhar `staging` ao baseline 0001;
- [x] integrar adapter PostgreSQL ao runtime Vercel;
- [x] validar dependências/adapter no CI;
- [x] consolidar `package-lock.json` e `npm ci`;
- [x] criar roles e principals segregados de runtime com menor privilégio;
- [x] implementar e empacotar readiness PostgreSQL sanitizado;
- [x] validar staging pós-promoção e confirmar blocker de credencial por HTTP 503;
- [ ] definir credencial de runtime de staging e configurar `DATABASE_URL`;
- [ ] validar staging `ready`;
- [ ] definir credencial de runtime de production e configurar `DATABASE_URL`;
- [ ] validar production `ready`;
- [ ] validar evidências finais e concluir 006.

## Gate de conclusão

A fase 006 somente será `CONCLUDED` quando houver:

- acesso PostgreSQL de runtime integrado sem secret versionado;
- migration framework versionado no repositório;
- baseline reproduzível a partir de banco limpo;
- execução e validação em Neon não produtivo;
- promoção controlada do baseline oficial;
- role de aplicação com menor privilégio e segregação da role de migration;
- `DATABASE_URL` provisionada por ambiente de runtime;
- readiness operacional `ready` em staging e production;
- CI cobrindo migrations, dependências de runtime e artefato imutável;
- documentação de aplicação e recuperação;
- nenhuma entidade de fase posterior antecipada indevidamente.

Estado oficial:

```text
005 = CONCLUDED
006 = ACTIVE / BLOCKED ON B006-02
007 = NOT ACTIVE
G1  = NOT APPROVED
```
