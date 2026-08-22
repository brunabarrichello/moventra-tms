# Moventra TMS — Database Migrations

## Escopo

Este documento define o mecanismo de migrations da fase `006 — Banco Base`. Ele cobre somente fundação técnica e não autoriza antecipar entidades das fases oficiais posteriores.

## Runner oficial

Comando:

```bash
node scripts/db/migrate.mjs
```

Contrato de entrada:

- `DATABASE_URL` deve existir apenas no ambiente de execução/secret store;
- a connection string nunca deve ser versionada;
- o runner converte a URL para variáveis `PG*` do processo filho e remove `DATABASE_URL` do ambiente do `psql`;
- `psql` é o cliente PostgreSQL requerido pelo runner.

## Ordenação e imutabilidade

Migrations ficam em `db/migrations` e usam o padrão:

```text
NNNN_nome_da_migration.sql
```

Regras:

1. versões são inteiras de quatro dígitos e únicas;
2. a ordem é crescente;
3. cada arquivo recebe SHA-256 antes da aplicação;
4. a história é gravada em `moventra_meta.schema_migrations`;
5. migration já aplicada com checksum diferente é falha crítica;
6. migration já aplicada com mesmo checksum é ignorada com segurança;
7. cada nova migration é aplicada em transação;
8. advisory lock transacional reduz risco de concorrência de aplicação.

## Baseline da fase 006

A migration `0001_foundation.sql` cria somente metadata interna do banco. É proibido criar nesta fase entidades como tenants, companies, branches, users, memberships, roles, permissions ou audit logs.

Essas entidades continuam reservadas às suas fases oficiais.

## Validação

Cada migration deve possuir arquivo correspondente em `db/validation` no formato:

```text
NNNN_nome_da_migration_validation.sql
```

A validation deve ser read-only e falhar explicitamente quando o contrato não for atendido.

O CI da fundação sobe PostgreSQL limpo, aplica todas as migrations, executa o runner novamente para provar comportamento idempotente e roda as validations.

## Neon

Source of truth atual:

- projeto `moventra-tms`;
- database `neondb`;
- branches permanentes `main`, `staging` e `development`.

Antes de aplicar uma alteração em `main`, validar em branch temporária ou branch não produtiva. A branch `main` não deve receber alterações exploratórias.

## Rollback e forward-fix

Política padrão: **forward-fix**.

Migrations aplicadas não devem ser editadas nem revertidas destrutivamente por rotina. Quando houver defeito:

1. bloquear novas promoções;
2. avaliar impacto e compatibilidade;
3. criar migration corretiva com nova versão;
4. validar em ambiente não produtivo;
5. promover a correção pela mesma cadeia auditável.

Para incidentes que exijam recuperação de estado, usar recursos de branch/PITR/restore do Neon conforme severidade e plano de recuperação. Reversões destrutivas manuais em production não fazem parte do fluxo normal.

## Segurança

Nunca:

- imprimir `DATABASE_URL`;
- persistir connection strings em artifacts;
- colocar credenciais em SQL versionado;
- reutilizar banco de production para testes de migrations;
- aplicar migration não versionada diretamente em production.
