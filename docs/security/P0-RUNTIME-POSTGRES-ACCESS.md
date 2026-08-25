# P0 — Runtime PostgreSQL Access Contract

## Estado

`ACTIVE`

## Contexto

A auditoria pós-G2 confirmou que as roles de login de runtime (`moventra_app_staging` e `moventra_app_production`) existem, não possuem privilégios administrativos e herdam as respectivas roles `moventra_runtime_*`, porém as roles de runtime não possuem `USAGE` nos schemas de domínio nem privilégios sobre as tabelas 008–017.

O endpoint `/api/database-health` prova conectividade e versão PostgreSQL, mas não prova autorização do principal de runtime sobre o modelo funcional.

## Objetivo

Concluir o contrato de menor privilégio necessário para que o principal de runtime execute a fundação 008–017 sem usar owner, `SUPERUSER`, `CREATEDB`, `CREATEROLE` ou `BYPASSRLS`, preservando RLS e append-only Audit.

## Princípios

- privilégios são concedidos à role NOLOGIN de runtime; a role LOGIN de aplicação apenas herda;
- nenhum objeto de aplicação muda de owner;
- nenhum runtime recebe `BYPASSRLS`;
- schemas `organization`, `identity`, `security` e `audit` recebem somente `USAGE`;
- tabelas de lifecycle recebem `SELECT`, `INSERT`, `UPDATE`; exclusão física permanece proibida;
- `security.permissions` é catálogo global controlado pela plataforma e recebe somente `SELECT` no runtime;
- `audit.audit_events` recebe `SELECT`, `INSERT` e nunca `UPDATE`/`DELETE`;
- `security.current_tenant_id()` recebe `EXECUTE` explícito;
- qualquer evolução futura de privilégios exige atualização deste contrato e teste automatizado.

## Matriz mínima

| Objeto | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| organization.tenants | sim | sim | sim | não |
| organization.companies | sim | sim | sim | não |
| organization.branches | sim | sim | sim | não |
| identity.users | sim | sim | sim | não |
| identity.memberships | sim | sim | sim | não |
| identity.external_identities | sim | sim | sim | não |
| security.permissions | sim | não | não | não |
| security.roles | sim | sim | sim | não |
| security.role_permissions | sim | sim | não | sim |
| security.membership_roles | sim | sim | sim | não |
| security.organizational_scopes | sim | sim | sim | não |
| security.role_assignment_scopes | sim | sim | não | sim |
| audit.audit_events | sim | sim | não | não |

## Implementação

O contrato é aplicado por `scripts/db/runtime-privileges.mjs`, que exige `RUNTIME_DATABASE_ROLE` explícita e valida o identificador antes de executar qualquer SQL. O script é ambiente-neutro e não cria usuários nem credenciais.

A validação automatizada cria uma role NOLOGIN efêmera no PostgreSQL de CI, aplica o mesmo contrato e verifica permissões positivas e negativas.

## Gate

1. repositório e CI verdes;
2. aplicar e validar em Neon Staging;
3. executar smoke com `SET ROLE moventra_runtime_staging`, Tenant A/B, RLS e Audit;
4. somente depois solicitar aprovação externa para Main/Production;
5. revalidar G2 com evidência E2E.

Nenhuma fase 018 é ativada enquanto este P0 estiver aberto.
