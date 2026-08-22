# 006 — Banco Base

## Estado

`ACTIVE / RUNTIME + NEON PROMOTION PENDING`

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

Timezone atual do servidor: `GMT`.

### Branches Neon permanentes

| Ambiente lógico | Branch Neon | Branch ID | Estado |
|---|---|---|---|
| production/base | `main` | `br-morning-glitter-au97suq4` | ready |
| staging | `staging` | `br-rapid-math-au6j6xut` | ready |
| development | `development` | `br-summer-cloud-aulfwdsv` | ready |

Não criar projeto Neon duplicado enquanto este permanecer como source of truth.

## Baseline verificado em `main`

- database `neondb` acessível com role proprietária;
- schema de aplicação atual: `public`;
- zero tabelas de aplicação;
- zero views de aplicação;
- extensão instalada: apenas `plpgsql`;
- existe função utilitária `public.show_db_tree`, criada pela infraestrutura/ferramenta;
- nenhum domínio TMS foi materializado;
- `DATABASE_URL` existe somente como nome de contrato em `.env.example`, sem valor versionado.

## Delta audit da migration preexistente

Ao ativar a 006 foi identificado que a antiga `db/migrations/0001_foundation.sql` antecipava tenants, companies, branches, users, memberships, RBAC e auditoria. Essa migration não havia sido aplicada no Neon oficial, pois a branch `main` permanecia sem tabelas de aplicação.

A migration foi corrigida antes da primeira aplicação para um baseline estritamente não-domínio. Testes arquiteturais e validation agora bloqueiam regressão dessa antecipação.

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
- aceita `DATABASE_URL` nos ambientes reais e contrato `PG*` em contextos controlados de CI/administração;
- remove `DATABASE_URL` do ambiente do processo filho `psql` e não passa a connection string como argumento;
- validation SQL correspondente a cada migration.

A migration `0001_foundation.sql` cria somente `moventra_meta.database_contract`; o runner cria o histórico técnico `moventra_meta.schema_migrations`. Nenhuma entidade de tenant, empresa, filial, usuário, RBAC ou auditoria é criada nesta fase.

## Evidência de CI

PR #28 validou o framework com:

- Foundation CI #111 = success;
- Moventra CI #106 = success;
- Repository contract = success;
- Tests = success;
- Security baseline = success;
- Lint = success;
- PostgreSQL migration contract = success;
- aplicação da migration em PostgreSQL 18 limpo = success;
- segunda execução do runner/idempotência do histórico = success;
- validation 0001 = success;
- build imutável = success;
- CI evidence = success.

PR #28 foi squash-merged na `main` como `ee4a5a265efbcccc4b825d2eda272359b160238d`.

## Validação Neon temporária

Foi criada uma branch Neon temporária filha da `main` para validar o baseline sem alterar o banco principal.

Resultado:

- PostgreSQL 18+ confirmado;
- `moventra_meta.schema_migrations` presente;
- `moventra_meta.database_contract` presente;
- registro de contrato `Moventra TMS / moventra-tms / version 1` válido;
- migration 0001 registrada com checksum SHA-256 válido;
- somente 2 tabelas internas em `moventra_meta`;
- schema `public` permanece com zero tabelas;
- nenhum schema ou tabela das fases 008+ foi criado;
- validation oficial executada sem exceção.

A promoção da migration temporária para a branch Neon `main` permanece pendente de confirmação explícita exigida pelo fluxo seguro de migration.

## Runtime PostgreSQL em implementação

Decisão para o runtime atual em Vercel:

- `pg` (node-postgres) como driver PostgreSQL;
- Vercel Fluid Compute habilitado;
- `attachDatabasePool` para lifecycle do pool no ambiente Vercel;
- adapter isolado em `src/infrastructure/database/postgres.js`;
- domínio/core sem dependência de `pg`, Neon ou Vercel;
- `DATABASE_URL` como secret de runtime;
- connection pooled para runtime e conexão direta para migrations;
- fronteira transacional explícita com `BEGIN/COMMIT/ROLLBACK` e liberação garantida do client.

Versões diretas inicialmente fixadas:

- `pg = 8.23.0`;
- `@vercel/functions = 3.9.3`.

A branch `phase/006-runtime-postgres` adiciona CI para instalar/verificar essas dependências antes de permitir build.

## Decisões da fase

1. PostgreSQL/Neon é o banco transacional primário inicial do monólito modular.
2. O banco deve ser criado/evoluído exclusivamente por migrations versionadas e reproduzíveis.
3. Nenhuma credencial ou connection string real será versionada.
4. `DATABASE_URL` será resolvida por secret store por ambiente.
5. Migrations aplicadas são imutáveis; correções posteriores usam nova migration.
6. A política padrão de recuperação de schema é forward-fix; restore/PITR é reservado a incidentes que justifiquem recuperação de estado.
7. Alterações são testadas em branch temporária/ambiente não produtivo antes de aplicação em `main`.
8. Esta fase não cria entidades de fases posteriores.
9. Convenções detalhadas de dados permanecem reservadas à fase `007 — Convenções de Dados`.
10. A role de runtime deverá ser separada da role administrativa/migration antes da conclusão da fase.

## Trabalho ativo

- [x] identificar projeto Neon oficial existente;
- [x] identificar versão PostgreSQL, região e database inicial;
- [x] inventariar branches `main`, `staging` e `development`;
- [x] confirmar baseline vazio de tabelas/views de aplicação;
- [x] corrigir migration preexistente que antecipava fases posteriores;
- [x] implementar mecanismo de migrations baseado em SQL + `psql`;
- [x] criar controle de versão/checksum de migrations;
- [x] criar migration baseline não-domínio;
- [x] criar validation do baseline;
- [x] adicionar teste arquitetural impedindo entidades antecipadas na migration 0001;
- [x] documentar política de migration, forward-fix e recuperação;
- [x] validar job PostgreSQL no GitHub Actions;
- [x] validar migration em branch temporária Neon;
- [x] selecionar e implementar adapter PostgreSQL de runtime em branch de feature;
- [ ] validar dependências e adapter de runtime pelo CI/PR;
- [ ] promover a migration validada para Neon `main` após confirmação explícita;
- [ ] criar/selecionar role de runtime com menor privilégio distinta da role de migration;
- [ ] definir `DATABASE_URL` de runtime nos environments necessários sem expor valores;
- [ ] consolidar lock/reprodutibilidade das dependências de runtime;
- [ ] validar evidências finais e concluir 006.

## Gate de conclusão

A fase 006 somente será `CONCLUDED` quando houver:

- acesso PostgreSQL de runtime integrado sem secret versionado;
- migration framework versionado no repositório;
- baseline reproduzível a partir de banco limpo;
- execução e validação em Neon não produtivo;
- promoção controlada do baseline oficial;
- role de aplicação com menor privilégio e segregação da role de migration;
- CI cobrindo migrations e dependências de runtime;
- documentação de aplicação e recuperação;
- nenhuma entidade de fase posterior antecipada indevidamente.

Até lá:

```text
005 = CONCLUDED
006 = ACTIVE
007 = NOT ACTIVE
G1  = NOT APPROVED
```
