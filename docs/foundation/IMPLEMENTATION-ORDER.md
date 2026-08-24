# Continuidade da Fundação — Linha Oficial de Implantação

A fundação do Moventra TMS segue esta sequência sem antecipar módulos de negócio:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS/Defesa adicional → Auditoria**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidade e critérios documentados;
- **ACTIVE** — etapa oficialmente autorizada para execução;
- **PREPARED** — artefato técnico existe, mas a etapa ainda não está concluída;
- **IMPLEMENTED** — código ou infraestrutura existem fisicamente;
- **EVIDENCED** — execução real foi observada e validada;
- **CONCLUDED** — implementação, validação, evidência e governança do gate foram aprovadas.

A existência de schema, migration, workflow ou documento não promove automaticamente uma etapa para `CONCLUDED`.

## Estado canônico

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | identidade oficial, governança, CODEOWNERS, histórico e processo de mudança versionados |
| 002 — Arquitetura Base | **CONCLUDED** | ADR-0001 aceito; monólito modular permanece arquitetura inicial oficial |
| 003 — Ambientes | **CONCLUDED** | Development/Test/Staging/Production segregados |
| 004 — CI/CD | **CONCLUDED** | build-once, artefato imutável, staging, rollback/restore, production protegida, revision identity e evidence validados |
| 005 — Secrets Management | **CONCLUDED** | stores segregados, credenciais por ambiente, least privilege e governança validados |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, baseline 0001, migration framework, runtime least privilege e readiness validados; `B006-02 = RESOLVED` |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico, guardrails e CI verde |
| 008 — Tenant | **CONCLUDED** | migration 0002, lifecycle, optimistic locking, Neon e Production validados |
| 009 — Empresa | **CONCLUDED** | migration 0003, tenant-aware persistence, cross-tenant tests, Neon e Production validados |
| 010 — Filial | **CONCLUDED** | PR #61, migration 0004, tenant/company-aware persistence, cross-tenant/cross-company tests, Neon, Staging, rollback/restore e Production exata validados |
| 011 — Usuários | **ACTIVE / DEFINED** | identidade de negócio global/provider-agnostic; implementação autorizada sem Membership/Auth |
| 012 — Memberships | **NOT ACTIVE / DEFINED** | vínculo usuário ↔ tenant/empresa/filial depende da conclusão de Usuários |
| 013 — Auth | **NOT ACTIVE / DEFINED** | provider/credentials/external subjects não devem contaminar a identidade de negócio |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | autorização backend e modelo físico ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | enforcement tenant/company/branch será posterior a memberships/RBAC |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | ADR-0002 vigente; RLS somente após contexto/autorização/testes cross-tenant |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada |

## Banco — estado após 010

Neon PostgreSQL:

```text
PostgreSQL = 18.6
TimeZone = GMT
migration 0001 = present
migration 0002 = present
migration 0003 = present
migration 0004 = present
organization.tenants = present
organization.companies = present
organization.branches = present
identity.users = absent até implementação da 011
```

Checksums canônicos:

```text
0002_tenant.sql  = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
0003_company.sql = 149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
0004_branch.sql  = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
```

Branches Neon validadas:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = NOT APPROVED
```

G2 continua dependente, no mínimo, de Usuários, Memberships, Auth, RBAC, Escopo Organizacional, defesa adicional/RLS quando aplicável, testes de autorização/cross-tenant e Auditoria Central.

## 008 — Tenant concluída

Revisão funcional:

```text
ca0259da26a9d57513d3aecd1c9f972413376b58
```

Tenant é a raiz SaaS e não possui `tenant_id` autorreferente.

## 009 — Empresa concluída

PR técnica:

```text
#58 — feat(company): implement phase 009 tenant-aware company
merge funcional = 3a3980a88ee39f63985da8358d1d88b6faf0a526
```

CI, migration 0003, Neon Staging/Main, runtime Staging e Production protegida com revision identity exata foram validados.

## 010 — Filial concluída

PR técnica:

```text
#61 — feat(branch): implement phase 010 tenant/company-aware branch
merge funcional = e165a42954aea5c211b3812b5f2e0b34a9b24ada
```

CI:

```text
Foundation CI 32679033828 = success
Moventra CI 32679033865 = success
```

Neon Staging/Main:

```text
organization.branches = present
migration 0004 checksum = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
composite FK (tenant_id, company_id) -> companies(tenant_id, id) = present
UNIQUE (tenant_id, company_id, id) = present
headquarters unique partial index = present
smoke DRAFT -> ACTIVE/version 2 -> cleanup = success
```

Staging:

```text
revision = e165a42954aea5c211b3812b5f2e0b34a9b24ada
GET /health = 200
GET /api/database-health = 200
rollback/restore = observed
```

Production final:

```text
rollback deployment = dpl_FD4EDg1NP9sSRkj6rUiT4i6HyaN1
rollback revision = d6f0e611e8b5305a711189d4de103c704bec71f5
restore/current deployment = dpl_UuciGhqjen4EbCaZeCCoKxdDc8BV
stable GET /health = 200
stable revision = e165a42954aea5c211b3812b5f2e0b34a9b24ada
stable GET /api/database-health = 200 / ready
runtime errors pós-promoção = none observed
```

Conclusão:

```text
010 = CONCLUDED
```

## Fase ativa — 011 Usuários

A única etapa estrutural autorizada agora é **011 — Usuários**.

### Decisão de arquitetura

`User` representa a identidade humana/de negócio canônica do Moventra, independente de Tenant e independente de provider de autenticação.

Consequências:

```text
User não recebe tenant_id
User não recebe company_id/branch_id
User não contém password hash, session, OAuth subject ou provider id
User pode futuramente participar de vários Tenants via Membership
Membership pertence à fase 012
Auth/external identities pertencem à fase 013
```

A modelagem deve evitar duplicar uma pessoa para cada Tenant e evitar usar subject de Auth0/Clerk/Cognito/etc. como PK de domínio.

### Escopo mínimo esperado da 011

- schema `identity` quando necessário;
- `identity.users`;
- PK UUIDv7;
- email primário canônico com unicidade case-insensitive/canonicalizada;
- display name;
- locale/timezone opcionais de preferência pessoal quando justificados;
- lifecycle explícito sem representar membership ou autenticação;
- timestamps e optimistic locking;
- domínio/persistência mínima;
- testes positivos/negativos;
- migration/validation SQL;
- nenhuma Membership/Auth/RBAC/RLS/Auditoria antecipada.

### Lifecycle inicial recomendado

```text
PENDING -> ACTIVE | CLOSED
ACTIVE  -> SUSPENDED | CLOSED
SUSPENDED -> ACTIVE | CLOSED
CLOSED -> terminal
```

`PENDING` significa identidade criada/registrada internamente ainda não operacional. Não significa convite para Tenant; convite e vínculo pertencem a Membership/Auth conforme decisão da fase correspondente.

## Próxima transição oficial

```text
010 = CONCLUDED
011 = ACTIVE / DEFINED
012 = NOT ACTIVE
G2 = NOT APPROVED
```

Somente após todos os quality gates de Usuários:

```text
011 = CONCLUDED
012 — Memberships = ACTIVE
```

## Regra de revision identity para governança

A revisão funcional/runtime que conclui uma fase é registrada separadamente da revisão documental que promove a etapa seguinte. Commits exclusivamente documentais posteriores passam pela cadeia normal de CI/release, porém não reabrem uma fase funcional já promovida e evidenciada em Production.
