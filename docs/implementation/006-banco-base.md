# 006 — Banco Base

## Estado

`ACTIVE / DATABASE FOUNDATION IMPLEMENTATION`

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

### Branches Neon existentes

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
- `DATABASE_URL` existe apenas como nome de contrato em `.env.example`, sem valor versionado.

## Delta audit da migration preexistente

Ao ativar a 006 foi identificado que a antiga `db/migrations/0001_foundation.sql` antecipava tenants, companies, branches, users, memberships, RBAC e auditoria. Essa migration não havia sido aplicada no Neon oficial, pois a branch `main` permanece sem tabelas de aplicação.

A migration foi corrigida antes da primeira aplicação para um baseline estritamente não-domínio. O CI passa a impedir regressão dessa antecipação.

## Framework de migrations proposto nesta implementação

Runner: `node scripts/db/migrate.mjs`.

Características:

- migrations SQL versionadas e ordenadas;
- SHA-256 por migration;
- histórico em `moventra_meta.schema_migrations`;
- falha se uma migration aplicada for alterada;
- transação por migration;
- advisory lock transacional;
- reaplicação segura de migrations já registradas;
- `DATABASE_URL` convertida para variáveis `PG*` do processo `psql`, sem passagem da connection string como argumento;
- validation SQL correspondente a cada migration.

A migration `0001_foundation.sql` cria somente `moventra_meta.database_contract`. Nenhuma entidade de tenant, empresa, filial, usuário, RBAC ou auditoria é criada nesta fase.

## CI proposto

O job `PostgreSQL migration contract` deverá:

1. subir PostgreSQL 18 limpo;
2. aplicar todas as migrations;
3. executar novamente o runner para provar comportamento idempotente do histórico;
4. executar a validation da migration 0001;
5. bloquear o build imutável se o contrato do banco falhar.

## Decisões da fase

1. PostgreSQL/Neon é o banco transacional primário inicial do monólito modular.
2. O banco deve ser criado/evoluído exclusivamente por migrations versionadas e reproduzíveis.
3. Nenhuma credencial ou connection string real será versionada.
4. `DATABASE_URL` será resolvida por secret store por ambiente.
5. Migrations aplicadas são imutáveis; correções posteriores usam nova migration.
6. A política padrão de recuperação de schema é forward-fix; restore/PITR é reservado a incidentes que justifiquem recuperação de estado.
7. Alterações serão testadas em branch temporária/ambiente não produtivo antes de aplicação em `main`.
8. Esta fase não cria entidades de fases posteriores.
9. Convenções detalhadas de dados permanecem reservadas à fase `007 — Convenções de Dados`.

## Trabalho ativo

- [x] identificar projeto Neon oficial existente;
- [x] identificar versão PostgreSQL, região e database inicial;
- [x] inventariar branches `main`, `staging` e `development`;
- [x] confirmar baseline vazio de tabelas/views de aplicação;
- [x] corrigir migration preexistente que antecipava fases posteriores;
- [x] selecionar e implementar mecanismo de migrations baseado em SQL + `psql`;
- [x] criar controle de versão/checksum de migrations;
- [x] criar migration baseline não-domínio;
- [x] criar validation do baseline;
- [x] adicionar teste arquitetural impedindo entidades antecipadas na migration 0001;
- [x] documentar política de migration, forward-fix e recuperação;
- [ ] validar o novo job PostgreSQL no GitHub Actions;
- [ ] validar migration em branch temporária Neon;
- [ ] definir/integrar acesso PostgreSQL de runtime ao código;
- [ ] definir `DATABASE_URL` nos environments necessários sem expor valores;
- [ ] validar evidências finais e concluir 006.

## Gate de conclusão

A fase 006 somente será `CONCLUDED` quando houver:

- acesso PostgreSQL de runtime integrado sem secret versionado;
- migration framework versionado no repositório;
- baseline reproduzível a partir de banco limpo;
- execução e validação em Neon não produtivo;
- CI cobrindo migrations/contrato básico do banco;
- documentação de aplicação e recuperação;
- nenhuma entidade de fase posterior antecipada indevidamente.

Até lá:

```text
005 = CONCLUDED
006 = ACTIVE
007 = NOT ACTIVE
G1  = NOT APPROVED
```
