# 009 — Empresa

## Estado

`CONCLUDED`

Concluída oficialmente após implementação, validação e promoção protegida em Production da revisão funcional:

```text
3a3980a88ee39f63985da8358d1d88b6faf0a526
```

Transição oficial:

```text
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = ACTIVE / DEFINED
G1 = APPROVED
G2 = NOT APPROVED
```

## Objetivo concluído

A fase 009 materializou **Empresa** como organização jurídica/operacional pertencente a exatamente um Tenant do Moventra TMS.

Empresa permanece distinta de:

- Tenant — conta/raiz SaaS;
- Filial — unidade organizacional subordinada à Empresa, fase 010;
- cliente comercial do TMS — entidade futura do domínio CRM/Comercial;
- usuário/membership — identidade e vínculo de acesso, fases 011/012.

## Modelo físico implementado

Tabela:

```text
organization.companies
```

Migration:

```text
db/migrations/0003_company.sql
```

Validation SQL:

```text
db/validation/0003_company_validation.sql
```

Domínio/persistência:

```text
src/modules/organization/company/company-domain.js
src/modules/organization/company/company-repository.js
```

Testes:

```text
tests/unit/company-domain.test.js
tests/unit/company-repository.test.js
tests/architecture/company-phase.test.js
```

Campos materializados:

```text
id                          UUID / uuidv7()
tenant_id                   UUID NOT NULL
code                        business key tenant-aware
legal_name                  nome jurídico
display_name                nome de exibição opcional
registration_country        ISO 3166-1 alpha-2
primary_tax_identifier_type tipo jurisdicional opcional
primary_tax_identifier      identificador normalizado opcional
status                      lifecycle explícito
default_timezone            override opcional; NULL herda Tenant
default_currency            override opcional; NULL herda Tenant
created_at                  TIMESTAMPTZ
updated_at                  TIMESTAMPTZ
version                     BIGINT / optimistic locking
```

## Relação Tenant → Empresa

Cardinalidade:

```text
Tenant 1 ─────── 0..N Empresa
Empresa N ────── 1 Tenant
```

Regras consolidadas:

1. Empresa pertence a exatamente um Tenant;
2. `tenant_id` é imutável após criação;
3. `code` é único dentro do Tenant, não global;
4. todas as queries de negócio são tenant-scoped;
5. ativações exigem Tenant operacional (`ACTIVE`);
6. Tenant não operacional prevalece sobre o status local da Empresa;
7. futura Filial referencia a Empresa por chave tenant-aware.

## Constraints e índices relevantes

Implementados:

```text
PK (id)
FK (tenant_id) -> organization.tenants(id)
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, code)
INDEX (tenant_id, status)
UNIQUE parcial tenant-aware para identificador fiscal quando informado
```

A chave candidata `(tenant_id, id)` foi criada deliberadamente para permitir FKs compostas que preservem o boundary do Tenant nas fases posteriores.

## Identificador fiscal

O modelo central não é acoplado exclusivamente a CNPJ/Brasil.

O contrato utiliza:

```text
registration_country
primary_tax_identifier_type
primary_tax_identifier
```

Tipo e valor são opcionais, porém pareados. Regras jurisdicionais específicas pertencem ao boundary/domínio e podem evoluir sem transformar o banco central em uma enumeração rígida de países/documentos.

## Lifecycle implementado

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

`status` não é campo CRUD arbitrário. A camada de domínio valida transições e exige Tenant operacional quando uma Empresa é ativada.

## Concorrência

Mutações usam optimistic locking:

```text
WHERE tenant_id = ?
  AND id = ?
  AND version = expected_version
SET version = version + 1
```

Transições também condicionam o estado esperado. Stale version é conflito de concorrência e não deve sobrescrever silenciosamente alterações concorrentes.

## Isolamento tenant-aware

O repository não oferece mutações de negócio por `id` isolado. Leitura e escrita usam explicitamente o contexto de Tenant.

Os testes provaram, entre outros contratos:

```text
mesmo code em tenants diferentes = permitido
mesmo code no mesmo tenant = rejeitado
tenant incorreto não lê/altera Empresa
optimistic locking = enforced
tenant_id = não mutável
```

RLS permanece fora do escopo até a fase 016; o isolamento lógico de aplicação já é obrigatório e validado no backend.

## Evidência GitHub

PR técnica:

```text
#58 — feat(company): implement phase 009 tenant-aware company
MERGED
merge commit = 3a3980a88ee39f63985da8358d1d88b6faf0a526
```

CI da PR técnica:

```text
Foundation CI
run = 32675529694
conclusion = success

Moventra CI
run = 32675529687
conclusion = success
```

Quality gates aprovados:

```text
Repository contract = success
PostgreSQL runtime dependencies = success
Security baseline = success
Lint = success
Tests = success
PostgreSQL migration contract = success
Build immutable artifact = success
CI evidence = success
```

## Evidência Neon

Migration 0003 aplicada e validada em:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

Checksum canônico registrado:

```text
149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
```

Validado em ambos os ambientes:

```text
organization.companies = present
migration 0003 history = present
FK Tenant = present
UNIQUE (tenant_id, id) = present
INDEX (tenant_id, status) = present
unique fiscal tenant-aware = present
```

Smoke transacional e cross-tenant foi executado com cleanup. Ao final:

```text
smoke tenants = 0
smoke companies = 0
```

Nenhum dado operacional real foi deixado pelo smoke.

## Evidência Staging

A revisão funcional foi servida em Staging:

```text
revision = 3a3980a88ee39f63985da8358d1d88b6faf0a526
GET /health = 200
GET /api/database-health = 200
```

O warning conhecido do `pg` sobre futura semântica de `sslmode=require` permanece como hardening separado e não bloqueia a fase 009.

## Evidência Production

Após aprovação humana do environment protegido, um novo deployment Production foi observado:

```text
project = moventra-tms
deployment = dpl_GARNpGpTwdN3UxBfjpKmgngZHDF5
state = READY
target = production
aliasError = null
```

Revision identity:

```text
GET /health = HTTP 200
version = 3a3980a88ee39f63985da8358d1d88b6faf0a526
```

Database readiness foi observado no mesmo deployment pelos runtime logs:

```text
GET /api/database-health = HTTP 200
```

Observabilidade pós-deploy:

```text
runtime errors = none observed
```

O primeiro deploy Production após a tentativa anterior ainda servia a revisão de governança `63fc424...`; esse mismatch foi corretamente bloqueado e não foi aceito como evidência da fase. A fase só foi concluída após o deployment acima servir exatamente a revisão funcional `3a3980a...`.

## Restrições preservadas

A fase 009 não criou nem ativou antecipadamente:

```text
branches
users
memberships
roles
permissions
sessions
audit_logs
RLS policies
```

Também não alterou migrations já aplicadas 0001/0002.

## Quality gate final

- [x] modelo de Empresa coerente com 007/008/ADR-0002;
- [x] lifecycle formalizado;
- [x] identificador fiscal genérico/jurisdicional;
- [x] migration `0003` implementada;
- [x] validation SQL implementada;
- [x] migration validada em PostgreSQL 18 limpo após 0001/0002;
- [x] reexecução/histórico idempotente validado;
- [x] FK Tenant e unicidades tenant-aware validadas;
- [x] `(tenant_id, id)` disponível para FKs compostas;
- [x] domínio/persistência mínima implementados;
- [x] optimistic locking validado;
- [x] testes negativos e cross-tenant aprovados;
- [x] lint/test/build verdes;
- [x] PostgreSQL migration contract verde;
- [x] migration aplicada/validada em Neon staging e main;
- [x] staging runtime validado;
- [x] protected Production promotion concluída sem bypass;
- [x] Production revision identity/health/readiness validados;
- [x] evidência final registrada;
- [x] nenhuma fase 010+ antecipada durante a implementação da 009.

## Promoção

Resultado oficial:

```text
009 = CONCLUDED
010 — Filial = ACTIVE / DEFINED
G2 = NOT APPROVED
```

O commit `3a3980a88ee39f63985da8358d1d88b6faf0a526` é a revisão funcional/runtime que fecha a fase 009. Commits posteriores exclusivamente de governança/documentação não invalidam a evidência funcional já produzida; devem seguir a cadeia normal de CI/release sem criar um ciclo infinito de identidade de revisão.
