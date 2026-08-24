# 010 — Filial

## Estado

`CONCLUDED`

Concluída após implementação, validação de CI, aplicação/validação da migration em Neon Staging/Main, runtime Staging, rollback/restore e promoção protegida de Production com revision identity exata.

Estado após a promoção:

```text
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = ACTIVE / DEFINED
012 — Memberships = NOT ACTIVE
G2 = NOT APPROVED
```

## Objetivo

Materializar **Filial** como unidade organizacional/operacional subordinada a uma Empresa e pertencente ao mesmo Tenant no Moventra TMS.

Hierarquia canônica:

```text
Tenant
└── Empresa
    └── Filial
```

Filial não se confunde com Empresa, depósito/armazém, ponto de coleta/entrega, cliente comercial ou vínculo de acesso de usuário.

## Implementação física

Migration:

```text
db/migrations/0004_branch.sql
```

Validation SQL:

```text
db/validation/0004_branch_validation.sql
```

Domínio/persistência:

```text
src/modules/organization/branch/branch-domain.js
src/modules/organization/branch/branch-repository.js
```

Testes:

```text
tests/unit/branch-domain.test.js
tests/unit/branch-repository.test.js
tests/architecture/branch-phase.test.js
```

## Modelo relacional implementado

Tabela:

```text
organization.branches
```

Campos principais:

| Campo | Regra |
|---|---|
| `id` | UUIDv7, PK imutável |
| `tenant_id` | UUID NOT NULL, boundary SaaS |
| `company_id` | UUID NOT NULL, Empresa pai no mesmo Tenant |
| `code` | business key estável, única dentro da Empresa |
| `display_name` | nome operacional/exibição obrigatório |
| `is_headquarters` | boolean; no máximo uma sede por Empresa |
| `registration_country` | ISO 3166-1 alpha-2 opcional |
| `primary_tax_identifier_type` | tipo jurisdicional opcional |
| `primary_tax_identifier` | valor normalizado opcional |
| `status` | `DRAFT / ACTIVE / INACTIVE / CLOSED` |
| `default_timezone` | override IANA opcional |
| `default_currency` | override ISO 4217 opcional |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |
| `version` | BIGINT, optimistic locking |

## Integridade tenant/company-aware

Implementado:

```text
PK (id)
FK (tenant_id, company_id)
  -> organization.companies(tenant_id, id)
UNIQUE (tenant_id, company_id, id)
UNIQUE (tenant_id, company_id, code)
INDEX (tenant_id, company_id, status)
UNIQUE (tenant_id, company_id) WHERE is_headquarters
```

A FK composta prova no banco que a Filial pertence à Empresa no mesmo Tenant. `tenant_id` e `company_id` não são mutáveis por operações de negócio.

O índice unique parcial de headquarters garante no máximo uma Filial marcada como sede por Empresa, inclusive sob concorrência.

## Lifecycle

Estados:

```text
DRAFT
ACTIVE
INACTIVE
CLOSED
```

Transições:

```text
DRAFT    -> ACTIVE | CLOSED
ACTIVE   -> INACTIVE | CLOSED
INACTIVE -> ACTIVE | CLOSED
CLOSED   -> terminal
```

Ativação exige simultaneamente:

```text
Tenant.status = ACTIVE
Company.status = ACTIVE
```

A validação é realizada no domínio e reforçada atomicamente na persistência para reduzir race conditions entre leitura dos pais e atualização da Filial.

## Herança de configuração

Timezone efetivo:

```text
branch.default_timezone
?? company.default_timezone
?? tenant.default_timezone
```

Moeda efetiva:

```text
branch.default_currency
?? company.default_currency
?? tenant.default_currency
```

A tabela persiste apenas overrides da Filial.

## Concorrência

Mutações usam optimistic locking:

```text
tenant_id + company_id + id + expected_version
```

Transições condicionam também o estado esperado. Zero linhas atualizadas é tratado como ausência no escopo ou conflito de versão conforme a leitura tenant/company-scoped subsequente.

## Isolamento

Repository methods exigem explicitamente Tenant e Empresa. Não há operações de negócio por `branch_id` isolado.

Testes provam:

```text
tenant incorreto não lê/altera Filial
company incorreta dentro do mesmo tenant não lê/altera Filial
mesmo code em Empresas diferentes = permitido
mesmo code na mesma Empresa = rejeitado
headquarters duplicada = rejeitada
```

## Segurança e LGPD

- UUID não é autorização;
- `tenant_id` e `company_id` de payload não substituem o contexto autorizado;
- identificadores fiscais são opcionais e minimizados;
- nenhum secret é persistido em `branches`;
- Memberships/Auth/RBAC/RLS/Auditoria permanecem em fases posteriores;
- logs não devem registrar payloads completos sem necessidade.

## Evidência técnica

PR técnica:

```text
#61 — feat(branch): implement phase 010 tenant/company-aware branch
merge funcional = e165a42954aea5c211b3812b5f2e0b34a9b24ada
```

CI da revisão da PR:

```text
Foundation CI 32679033828 = success
Moventra CI 32679033865 = success
```

Controles aprovados no Moventra CI:

```text
Repository contract
Lint
Tests
Security baseline
PostgreSQL runtime dependencies
PostgreSQL migration contract
Build immutable artifact
CI evidence
```

## Neon Staging/Main

Migration aplicada nas branches oficiais:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

Contrato observado:

```text
version = 4
name = 0004_branch.sql
checksum = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
organization.branches = present
composite Company FK = present
UNIQUE (tenant_id, company_id, id) = present
headquarters unique partial index = present
status index = present
```

Smoke em Staging e Main:

```text
Tenant ACTIVE
→ Company ACTIVE
→ Branch DRAFT
→ Branch ACTIVE / version 2 / is_headquarters=true
→ cleanup completo
```

Após cleanup:

```text
smoke_tenants = 0
smoke_companies = 0
smoke_branches = 0
```

## Staging

A revisão funcional `e165a429...` foi servida em Staging com:

```text
GET /health = 200
version = e165a42954aea5c211b3812b5f2e0b34a9b24ada
GET /api/database-health = 200
```

A cadeia deploy → rollback → restore foi observada antes do gate de Production.

## Production protegida

A aprovação humana do ambiente protegido foi efetivada sem bypass.

Sequência observada:

```text
dpl_FD4EDg1NP9sSRkj6rUiT4i6HyaN1
  -> rollback revision d6f0e611e8b5305a711189d4de103c704bec71f5

dpl_UuciGhqjen4EbCaZeCCoKxdDc8BV
  -> restore/current production
```

Stable Production:

```text
GET /health = 200
status = ok
version = e165a42954aea5c211b3812b5f2e0b34a9b24ada

GET /api/database-health = 200
status = ready
version = e165a42954aea5c211b3812b5f2e0b34a9b24ada

runtime errors pós-promoção = none observed
```

A revision identity exigida para conclusão da fase corresponde exatamente ao merge funcional da PR #61.

## Quality gates

- [x] modelo de Filial revisado contra 007/008/009/ADR-0002;
- [x] lifecycle formalizado;
- [x] herança timezone/moeda formalizada;
- [x] contrato de sede/matriz formalizado;
- [x] migration `0004_branch.sql` implementada;
- [x] validation SQL implementada;
- [x] migration validada em PostgreSQL 18 após 0001/0002/0003;
- [x] reexecução/histórico idempotente validado;
- [x] FK composta para Empresa validada;
- [x] unicidades tenant/company-aware validadas;
- [x] domínio/persistência implementados;
- [x] optimistic locking validado;
- [x] testes cross-tenant e cross-company aprovados;
- [x] testes negativos aprovados;
- [x] lint/test/build verdes;
- [x] PostgreSQL migration contract verde;
- [x] migration aplicada e validada em Neon staging e main;
- [x] staging runtime validado;
- [x] rollback/restore validado;
- [x] protected Production promotion concluída sem bypass;
- [x] Production revision identity/health/readiness validados;
- [x] documentação/issue atualizadas;
- [x] nenhuma fase 011+ antecipada na implementação funcional da Filial.

## Conclusão

```text
010 = CONCLUDED
011 — Usuários = ACTIVE / DEFINED
012 — Memberships = NOT ACTIVE
G2 = NOT APPROVED
```

A próxima unidade oficial é **011 — Usuários**. Usuário deverá ser modelado como identidade de negócio global e provider-agnostic; relacionamento com Tenant/Empresa/Filial pertence à fase 012 — Memberships, e credenciais/subjects externos pertencem à fase 013 — Auth.
