# 018 — Configurações

## Estado

`CONCLUDED`

A fase 018 foi implementada, validada em PostgreSQL real, promovida por cadeia protegida até Production e encerrada com evidência técnica. A próxima fase oficial é **019 — Feature Flags**.

## Objetivo concluído

O Moventra TMS possui um subsistema empresarial de configurações com catálogo global tipado, overrides tenant-aware e resolução hierárquica por Tenant, Empresa e Filial, mantendo secrets fora deste domínio.

Precedência canônica:

```text
BRANCH > COMPANY > TENANT > DEFINITION_DEFAULT
```

## Modelo implementado

### `configuration.definitions`

Catálogo global do produto, sem `tenant_id`, governado pela plataforma.

Responsabilidades:

- chave estável e única;
- domínio proprietário;
- tipos lógicos `BOOLEAN`, `INTEGER`, `DECIMAL`, `STRING`, `ENUM`, `JSON`, `DURATION`, `TIMEZONE`, `CURRENCY`;
- default opcional;
- schema de validação;
- scopes de override permitidos;
- sensibilidade `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`;
- lifecycle `ACTIVE` / `INACTIVE`;
- optimistic locking.

`SECRET` não é suportado. Passwords, tokens, API keys, private keys, `DATABASE_URL` e credenciais permanecem no Secrets Management.

### `configuration.settings`

Valor atual tenant-scoped de uma definição em um scope organizacional.

Scopes:

```text
TENANT  => company_id IS NULL     AND branch_id IS NULL
COMPANY => company_id IS NOT NULL AND branch_id IS NULL
BRANCH  => company_id IS NOT NULL AND branch_id IS NOT NULL
```

Invariantes implementados:

- `tenant_id` obrigatório;
- candidate key `UNIQUE (tenant_id, id)`;
- FKs compostas impedem Company/Branch de outro Tenant;
- índices parciais garantem uma linha ativa por definição/scope;
- sem hard delete operacional;
- `version` implementa optimistic locking.

### `configuration.setting_versions`

Histórico tenant-scoped e append-only.

Regras:

- `UNIQUE (tenant_id, setting_id, setting_version)`;
- FK tenant-aware para `configuration.settings`;
- runtime possui apenas `SELECT` e `INSERT`;
- trigger de banco bloqueia `UPDATE`/`DELETE` inclusive fora do boundary normal de runtime;
- complementa, não substitui, `audit.audit_events`.

## Segurança

Permissões RBAC materializadas:

```text
configuration.settings.read
configuration.settings.manage
```

`configuration.settings` e `configuration.setting_versions` possuem RLS por `security.current_tenant_id()`; `configuration.definitions` permanece global e sem RLS tenant-based.

A role `moventra_runtime_production` permanece least-privilege e `NOBYPASSRLS`:

```text
schema configuration: USAGE = true
schema configuration: CREATE = false
definitions: SELECT = true, INSERT/UPDATE/DELETE = false
settings: SELECT/INSERT/UPDATE = true, DELETE = false
setting_versions: SELECT/INSERT = true, UPDATE/DELETE = false
```

Toda autorização crítica continua no backend. RLS é defesa adicional e não substitui Auth, Membership, RBAC ou Organizational Scope.

## Regras de negócio implementadas

- override somente em scope permitido pela Definition;
- Company/Branch precisam pertencer ao Tenant alvo;
- Branch precisa pertencer à Company informada;
- definição inativa não aceita novos overrides nem resolução operacional;
- setting inativo é ignorado e provoca fallback;
- update usa optimistic locking;
- alteração gera nova versão de setting na mesma unidade transacional;
- operações críticas reutilizam `AuthorizedTenantOperationService` e Audit;
- valores confidenciais são minimizados/redigidos de logs e Audit;
- PostgreSQL é a fonte de verdade;
- Tenant/Company/Branch recebidos do cliente são apenas alvo de recurso, nunca prova de autorização.

## Migration canônica

```text
db/migrations/0012_configuration.sql
SHA-256 = 4e31a90321a6480d00e2aa6b0d058c72f737241044c170db03e94eadb2f0eb5c
```

Registrada em `moventra_meta.schema_migrations` como versão 12.

## Evidência de CI e release

Revisão funcional/runtime:

```text
81b7edf3571aa5e3b37ce81c42ef6f4bf5311359
```

Execuções:

```text
Moventra CI          = 32848703847 = success
Foundation CI        = 32848703867 = success
Release Gate         = 32848816381 = success
Rollback Drill       = 32848933076 = success
Production Promotion = 32849065397 = success
```

Artefato imutável:

```text
moventra-tms-81b7edf3571aa5e3b37ce81c42ef6f4bf5311359
artifact SHA-256 = a78c06d8c973a96c1acef1761df277102effefb1ac464d58cb572553bd5d3ecd
```

## Evidência Staging

```text
initial  = dpl_AWavMEE5MZ9UjfbkDkZoi6eJcfRG = READY
rollback = dpl_HFfsuc3NCLoQh2JmqM6eCMaBiDi4 = READY
restore  = dpl_B9tJgcps8cmWDwB1X79AFmBLfTF3 = READY
```

Rollback utilizou a revisão anterior `bb8eb632d36c30618297f4a1069e538a916fe36c` e o restore retornou à revisão funcional 018. `/health` e `/api/database-health` foram validados no fluxo protegido.

## Evidência Production

O environment protegido `production` recebeu aprovação humana externa efetiva com `prevent_self_review=true` e sem bypass.

```text
Production deployment = dpl_ELC7hjcG2rCCJY2mA4vGWwmuYZdT
state                 = READY
revision              = 81b7edf3571aa5e3b37ce81c42ef6f4bf5311359
```

`/health` retornou HTTP 200 com revision identity exata. `/api/database-health` foi validado no workflow protegido. A verificação pós-promoção não encontrou runtime errors.

## Evidência Neon Main / Production

```text
project  = shiny-mode-01639948
branch   = br-morning-glitter-au97suq4
database = neondb
PostgreSQL = 18.6
```

Foram comprovados:

- migration 12 com checksum exato;
- três tabelas de configuração presentes;
- duas políticas RLS;
- duas permissões RBAC ativas;
- ACL least-privilege convergente;
- principal de aplicação non-owner/NOBYPASSRLS.

Smoke transacional Production sob `moventra_app_production` comprovou:

```text
resolver = BRANCH
optimistic lock = version 1 -> 2
stale update = sem efeito
cross-tenant visible settings = 0
history append-only = bloqueado
cleanup definitions/settings/history/tenants = 0 resíduos
```

O contexto RLS canônico usa a GUC transaction-local `moventra.tenant_id` consumida por `security.current_tenant_id()`.

## API alvo preservada

Resolver efetivo:

```text
GET /api/v1/configuration/effective/{key}
```

Alterar override:

```text
PUT /api/v1/configuration/settings/{key}
```

Quando exposta publicamente, escrita deverá usar idempotency key no boundary HTTP sem substituir optimistic locking.

## Observabilidade

O domínio preserva o contrato para métricas e logs sem expor valor confidencial:

```text
configuration_resolution_total
configuration_resolution_missing_total
configuration_resolution_source{source}
configuration_write_total{scope,outcome}
configuration_validation_failure_total
```

## Critérios de conclusão

- [x] migration canônica aditiva e backward-compatible;
- [x] validation canônica correspondente;
- [x] catálogo global tipado materializado;
- [x] settings Tenant/Empresa/Filial materializados com constraints e índices;
- [x] histórico append-only materializado e comprovado;
- [x] resolver `BRANCH > COMPANY > TENANT > DEFAULT` testado;
- [x] RBAC + Organizational Scope + RLS + Audit integrados;
- [x] runtime PostgreSQL least-privilege/NOBYPASSRLS;
- [x] cross-tenant bloqueado em PostgreSQL real;
- [x] optimistic locking testado;
- [x] secrets proibidos pelo contrato;
- [x] CI completo verde;
- [x] Neon Staging/Main validados;
- [x] smoke sem resíduos;
- [x] Staging + rollback/restore evidenciados;
- [x] Production protegida aprovada externamente;
- [x] revision identity, health, database readiness e runtime observability verificadas;
- [x] evidência registrada para sincronização de Issue/Confluence.

## Próxima transição

A fase **018 — Configurações = CONCLUDED**. A fase seguinte da linha oficial é **019 — Feature Flags = ACTIVE / DEFINED**. Nenhuma fase posterior à 019 está ativa.