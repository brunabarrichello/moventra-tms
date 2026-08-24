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

## Estado canônico em 23/08/2026

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | identidade oficial, governança, CODEOWNERS, histórico e processo de mudança versionados |
| 002 — Arquitetura Base | **CONCLUDED** | ADR-0001 aceito; monólito modular permanece arquitetura inicial oficial |
| 003 — Ambientes | **CONCLUDED** | Development/Test/Staging/Production segregados |
| 004 — CI/CD | **CONCLUDED** | build-once, artefato imutável, staging, rollback/restore, production protegida, revision identity e evidence validados |
| 005 — Secrets Management | **CONCLUDED** | stores segregados, credenciais por ambiente, least privilege e governança validados |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, baseline 0001, migration framework, runtime least privilege e readiness validados; `B006-02 = RESOLVED` |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico em `docs/data/DATA-CONVENTIONS.md`, guardrails e CI verde |
| 008 — Tenant | **CONCLUDED** | migration 0002, lifecycle, optimistic locking, Neon staging/main, staging, Production e evidência final validados |
| 009 — Empresa | **CONCLUDED** | PR #58, migration 0003, tenant-aware persistence, cross-tenant tests, Neon staging/main e Production exata `3a3980a...` validados |
| 010 — Filial | **ACTIVE / DEFINED** | autorizada após conclusão formal da 009; implementação ainda não concluída |
| 011 — Usuários | **NOT ACTIVE / DEFINED** | depende da conclusão de Filial |
| 012 — Memberships | **NOT ACTIVE / DEFINED** | vínculo usuário ↔ tenant/empresa/filial ainda não implementado |
| 013 — Auth | **NOT ACTIVE / DEFINED** | provider não deve contaminar identidade de negócio |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | autorização backend e modelo físico ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | enforcement tenant/company/branch será posterior a RBAC/memberships |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | ADR-0002 vigente; RLS somente após contexto/autorização/testes cross-tenant |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada |

## Banco — estado após 009

Neon PostgreSQL:

```text
PostgreSQL = 18.6
TimeZone = GMT
migration 0001 = present
migration 0002 = present
migration 0003 = present
organization.tenants = present
organization.companies = present
organization.branches = absent até implementação da 010
```

Checksums canônicos:

```text
0002_tenant.sql  = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
0003_company.sql = 149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
```

Branches validadas:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

## Gate G1 — Foundation Ready

`G1 = APPROVED` e permanece vigente.

## 008 — Tenant concluída

Revisão funcional:

```text
ca0259da26a9d57513d3aecd1c9f972413376b58
```

Checkpoint/governança subsequente:

```text
96842a2dfd539ffac796a7f1bcfca2ad3227cc30
63fc42417aac805f49c741d60bbf0525184648a0
```

A conclusão da 008 permanece válida porque a revisão funcional foi promovida e evidenciada antes da promoção documental da fase seguinte.

## 009 — Empresa concluída

PR técnica:

```text
#58 — feat(company): implement phase 009 tenant-aware company
merge funcional = 3a3980a88ee39f63985da8358d1d88b6faf0a526
```

CI:

```text
Foundation CI 32675529694 = success
Moventra CI 32675529687 = success
```

O Moventra CI aprovou:

```text
Repository contract
PostgreSQL runtime dependencies
Security baseline
Lint
Tests
PostgreSQL migration contract
Build immutable artifact
CI evidence
```

Neon staging/main:

```text
organization.companies = present
migration 0003 checksum = canonical
FK tenant = present
UNIQUE (tenant_id, id) = present
cross-tenant smoke + cleanup = success
```

Staging:

```text
revision = 3a3980a88ee39f63985da8358d1d88b6faf0a526
GET /health = 200
GET /api/database-health = 200
```

Production final:

```text
project = moventra-tms
deployment = dpl_GARNpGpTwdN3UxBfjpKmgngZHDF5
state = READY
target = production
revision = 3a3980a88ee39f63985da8358d1d88b6faf0a526
GET /health = 200
GET /api/database-health = 200
runtime errors pós-deploy = none observed
```

Uma tentativa Production anterior serviu a revisão `63fc424...` e foi rejeitada como evidência por revision mismatch. Não houve bypass; a 009 só foi promovida após Production servir exatamente `3a3980a...`.

Conclusão:

```text
009 = CONCLUDED
```

## Gate G2 — Security Ready

`G2 = NOT APPROVED`.

G2 continua dependente, no mínimo, de:

- Filial e escopo organizacional;
- usuários e memberships;
- autenticação;
- RBAC;
- enforcement de escopo organizacional;
- defesa adicional/RLS quando aplicável;
- testes cross-tenant abrangentes;
- auditoria transversal.

## Fase ativa — 010 Filial

A única etapa estrutural autorizada agora é **010 — Filial**.

Filial representa uma unidade organizacional/operacional pertencente a uma Empresa e, por consequência, ao mesmo Tenant. Deve preservar coerência tenant-aware por FK composta e não pode ser confundida com Empresa, depósito, ponto de coleta/entrega, parceiro ou cliente comercial.

A 010 deve definir e implementar:

- identidade UUIDv7;
- `tenant_id UUID NOT NULL`;
- `company_id UUID NOT NULL`;
- FK composta `(tenant_id, company_id)` para `organization.companies(tenant_id, id)`;
- business key única dentro da Empresa;
- nome de exibição e identificadores mínimos da unidade;
- opcionalidade de identificador fiscal de estabelecimento sem acoplamento exclusivo ao Brasil;
- lifecycle/status explícito;
- regra de ativação dependente de Tenant e Empresa operacionais;
- timezone/moeda como overrides opcionais, herdando Empresa/Tenant quando ausentes;
- optimistic locking;
- constraints/índices tenant-aware;
- chave candidata composta para referências futuras;
- migration/validation SQL, domínio, repository e testes cross-tenant/cross-company;
- nenhuma entidade 011+ antecipada.

## Próxima transição oficial

```text
006 = CONCLUDED
G1 = APPROVED
007 = CONCLUDED
008 = CONCLUDED
009 = CONCLUDED
010 = ACTIVE / DEFINED
011 = NOT ACTIVE
G2 = NOT APPROVED
```

Somente após todos os quality gates da Filial:

```text
010 = CONCLUDED
011 — Usuários = ACTIVE
```

## Regra de revision identity para governança

A revisão funcional/runtime que conclui uma fase é registrada separadamente da revisão documental que promove a etapa seguinte. Commits exclusivamente documentais posteriores devem passar pela cadeia normal de CI/release, porém não reabrem uma fase funcional já comprovadamente promovida em Production.
