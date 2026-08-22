# 006 — Banco Base

## Estado

`ACTIVE / BLOCKED ON RUNTIME CREDENTIAL PROVISIONING`

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
| staging | `staging` | `br-rapid-math-au6j6xut` | ready |
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

## Evidências de CI

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

Todos os gates passaram, inclusive `PostgreSQL runtime dependencies` e `PostgreSQL migration contract`.

PR #29 foi squash-merged em `20bb82e9a82fa0a88d4670681ab0cebd05c17d05`.

### PR #30 — reprodutibilidade de dependências

- `package-lock.json` versionado;
- CI alterado para instalação travada por lockfile com `npm ci`;
- emissão temporária do lockfile removida antes do merge;
- Foundation CI #117 = success;
- Moventra CI #112 = success;
- lint, testes, security baseline, runtime dependencies, migration contract, build e CI evidence = success.

PR #30 foi squash-merged em `992fd332185b97aed2407b440b5c3de664ad1823`.

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

### Validação pós-promoção em `main`

A validation oficial foi reexecutada diretamente em `br-morning-glitter-au97suq4` sem exceção.

Registro canônico:

- migration version: `1`;
- migration name: `0001_foundation.sql`;
- checksum: `465a15f85d98c7d81cb40bcd6ac902085eb017b99e8cc604dd279a53726c1efa`;
- applied at: `2026-08-22T22:01:21.377Z`;
- applied by: `neondb_owner`.

Inventário pós-promoção de tabelas:

- `moventra_meta.database_contract`;
- `moventra_meta.schema_migrations`.

Nenhuma entidade de Tenant, Empresa, Filial, Usuários, Memberships, RBAC ou Auditoria foi criada.

## Runtime e environments Vercel

Projetos oficiais identificados:

| Ambiente | Projeto Vercel | Project ID |
|---|---|---|
| staging | `moventra-tms-staging` | `prj_4USELVoAr0FsHg2vBNGXws7hU22Q` |
| production | `moventra-tms` | `prj_5qFenjyeGE1joaGomaNrUIRGSBQs` |

O conector Vercel disponível permite consultar projetos/deployments/logs, mas não expõe nem administra Environment Variables/Secrets. O conector GitHub também não expõe administração de secrets para esse requisito.

Consequentemente, a existência/configuração de `DATABASE_URL` de runtime ainda não pode ser comprovada ou criada por automação segura nesta sessão.

## Blockers finais

### B006-01 — role de aplicação com menor privilégio

A aplicação ainda não possui evidência de uma role PostgreSQL de runtime separada da role administrativa/migration. Não é aceitável consolidar `neondb_owner` como credencial permanente da aplicação.

Requisito para fechamento:

- criar/selecionar role de runtime dedicada;
- conceder somente privilégios necessários;
- manter DDL/migrations restritos à role administrativa/migration;
- registrar owner, escopo e procedimento de rotação sem expor a senha.

### B006-02 — `DATABASE_URL` de runtime por ambiente

Ainda falta evidência segura de que staging e production possuem `DATABASE_URL` apropriada para suas respectivas credenciais/branches, armazenada no secret store do runtime e nunca versionada.

Aceitar como evidência:

- metadata/tela administrativa com nome da variável e environment, sem mostrar o valor; ou
- integração administrativa que confirme presença/escopo sem retornar o valor.

Nunca aceitar:

- valor da connection string;
- senha;
- hash/prefixo do segredo;
- screenshot com material sensível exposto.

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
10. A role de runtime deve ser separada da role administrativa/migration antes da conclusão da fase.

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
- [x] integrar adapter PostgreSQL ao runtime Vercel;
- [x] validar dependências/adapter no CI;
- [x] consolidar `package-lock.json` e `npm ci`;
- [ ] criar/selecionar role de runtime com menor privilégio distinta da role de migration;
- [ ] definir/provar `DATABASE_URL` nos environments necessários sem expor valores;
- [ ] validar evidências finais e concluir 006.

## Gate de conclusão

A fase 006 somente será `CONCLUDED` quando houver:

- acesso PostgreSQL de runtime integrado sem secret versionado;
- migration framework versionado no repositório;
- baseline reproduzível a partir de banco limpo;
- execução e validação em Neon não produtivo;
- promoção controlada do baseline oficial;
- role de aplicação com menor privilégio e segregação da role de migration;
- `DATABASE_URL` provisionada por ambiente de runtime com evidência segura;
- CI cobrindo migrations e dependências de runtime;
- documentação de aplicação e recuperação;
- nenhuma entidade de fase posterior antecipada indevidamente.

Estado oficial:

```text
005 = CONCLUDED
006 = ACTIVE / BLOCKED ON B006-01 + B006-02
007 = NOT ACTIVE
G1  = NOT APPROVED
```
