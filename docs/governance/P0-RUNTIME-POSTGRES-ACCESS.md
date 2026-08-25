# P0 — Runtime PostgreSQL Access Contract

## Estado

`ACTIVE / IMPLEMENTED IN BRANCH / PRODUCTION NOT CHANGED`

## Origem

Auditoria integral pós-G2 identificou que as roles `moventra_runtime_staging` e `moventra_runtime_production` estavam corretamente segregadas e sem `BYPASSRLS`, porém sem `USAGE` nos schemas de domínio e sem privilégios nas tabelas 008–017. O readiness existente provava conectividade PostgreSQL, não capacidade de executar o domínio.

Issue: #81.

## Decisão

Tratar privilégios de runtime como contrato de infraestrutura versionado e separado das migrations de schema.

O arquivo `db/runtime/runtime-access.sql` recebe a role de autorização por variável `psql` e converge explicitamente o menor privilégio necessário. As migrations de aplicação continuam provider/environment-neutral e não criam ou nomeiam roles de staging/production.

## Matriz de acesso

| Recurso | Runtime |
|---|---|
| schemas `organization`, `identity`, `security`, `audit` | `USAGE`, sem `CREATE` |
| `organization.tenants/companies/branches` | `SELECT, INSERT, UPDATE`; sem `DELETE` |
| `identity.users/memberships/external_identities` | `SELECT, INSERT, UPDATE`; sem `DELETE` |
| `security.permissions` | `SELECT` somente |
| roles/grants/scopes tenant-scoped | `SELECT, INSERT, UPDATE`; sem `DELETE` |
| `audit.audit_events` | `INSERT` + `SELECT(id, occurred_at)` para `RETURNING`; sem table-level SELECT/UPDATE/DELETE |
| `moventra_meta` | nenhum acesso |
| DDL em schemas de aplicação | negado |

O catálogo global `security.permissions` permanece platform-owned; runtime normal não pode criar ou alterar permission codes. O repositório de RBAC pode manter operações administrativas em código, mas elas não devem ser expostas por fluxo runtime comum sem uma credencial administrativa explicitamente separada.

## RLS

O contrato não relaxa RLS. O principal real continua `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` e `NOBYPASSRLS`.

A validação automatizada cria um principal sintético não proprietário, aplica o contrato e prova:

- leitura do Tenant corrente;
- bloqueio de leitura cross-tenant;
- bloqueio de escrita cross-tenant;
- escrita permitida de identidade/membership dentro do contexto correto;
- append de Audit com `RETURNING` mínimo;
- bloqueio de UPDATE/DELETE em Audit;
- bloqueio de mutação do permission catalog;
- bloqueio de `moventra_meta`;
- bloqueio de DDL.

## CI

`db/validation/0012_runtime_access_validation.sql` é descoberto automaticamente pelo `PostgreSQL migration contract` existente após as migrations `0001–0011`. Ele não adiciona uma migration 0012; é uma validação de infraestrutura posterior ao schema atual.

## Sequência de promoção

1. validar PR/CI;
2. aplicar o mesmo contrato em Neon Staging para `moventra_runtime_staging`;
3. executar smoke transacional sob a role não proprietária e confirmar zero resíduos;
4. somente então solicitar gate humano para Neon Main/Production;
5. após aprovação, aplicar a `moventra_runtime_production`, revalidar RLS/readiness e sincronizar a governança do G2.

A fase 018 permanece `NOT ACTIVE` até a conclusão deste P0.
