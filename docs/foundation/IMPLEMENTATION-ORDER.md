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
| 003 — Ambientes | **CONCLUDED** | Development/Test/Staging/Production segregados conforme a arquitetura vigente |
| 004 — CI/CD | **CONCLUDED** | build-once, artefato imutável, staging, rollback/restore, production protegida, revision identity e evidence validados |
| 005 — Secrets Management | **CONCLUDED** | stores segregados, credenciais por ambiente, least privilege e governança de secrets validados |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, baseline técnico 0001, migration framework, runtime least privilege e readiness validados; `B006-02 = RESOLVED` |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico em `docs/data/DATA-CONVENTIONS.md`, guardrails automatizados, PR #51 e CI verde |
| 008 — Tenant | **CONCLUDED** | PR #54; migration 0002; lifecycle/optimistic locking; CI verde; Neon staging/main; staging; protected Production promotion; health/readiness/evidence validados |
| 009 — Empresa | **ACTIVE / DEFINED** | autorizada após conclusão formal da 008; nenhuma tabela `companies` criada antes desta ativação |
| 010 — Filial | **NOT ACTIVE / DEFINED** | depende da conclusão de Empresa |
| 011 — Usuários | **NOT ACTIVE / DEFINED** | depende da sequência organizacional vigente |
| 012 — Memberships | **NOT ACTIVE / DEFINED** | vínculo usuário ↔ tenant/empresa/filial ainda não implementado |
| 013 — Auth | **NOT ACTIVE / DEFINED** | provider não deve contaminar identidade de negócio |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | autorização backend e modelo físico ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | enforcement tenant/company/branch será posterior a RBAC/memberships |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | ADR-0002 vigente; RLS somente após contexto/autorização/testes cross-tenant |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada |

## Banco — baseline de domínio após 008

Neon PostgreSQL:

```text
PostgreSQL = 18.6
TimeZone = GMT
migration 0001 = present
migration 0002 = present
organization.tenants = present
organization.companies = absent até implementação da 009
```

Migration 0002:

```text
name = 0002_tenant.sql
checksum = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
```

Branches validadas:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

A raiz Tenant não possui `tenant_id` autorreferente. Entidades organizacionais das fases seguintes devem ser tenant-scoped e obedecer `DATA-CONVENTIONS.md` e ADR-0002.

## Gate G1 — Foundation Ready

`G1 = APPROVED` em 23/08/2026 e permanece vigente.

## 007 — evidência de conclusão

```text
PR #51
merge commit = 46e08ce5cefe2c5d3df9eb89bcaee096dc9f9fa5
Foundation CI run = 32672159870 / success
Moventra CI run = 32672159907 / success
```

## 008 — evidência de conclusão

Implementação:

```text
PR #54
merge funcional = ca0259da26a9d57513d3aecd1c9f972413376b58
```

Checkpoint canônico:

```text
PR #55
main checkpoint = 96842a2dfd539ffac796a7f1bcfca2ad3227cc30
```

Quality gates:

```text
Foundation CI 32673556166 = success
Moventra CI 32673556165 = success
Foundation CI 32674044981 = success
Moventra CI 32674044984 = success
```

Neon staging/main:

```text
organization.tenants = present
migration 0002 checksum = canonical
smoke create -> ACTIVE/version 2 -> cleanup = success
```

Protected Production promotion:

```text
project = moventra-tms
deployment = dpl_9fUgkq9WjNRY7berBmKkZCQes9s6
state = READY
target = production
node = 22.x
main revision = 96842a2dfd539ffac796a7f1bcfca2ad3227cc30
```

Pós-deploy observado:

```text
GET /health = 200 (deployment + stable URL)
GET /api/database-health = 200 (deployment + stable URL)
runtime errors pós-deploy = none observed
```

O workflow de Production Promotion é fail-closed: valida `main`, artefato imutável/rollback evidence, approval protegido e revision identity antes de executar database readiness.

Conclusão:

```text
008 = CONCLUDED
```

## Gate G2 — Security Ready

`G2 = NOT APPROVED`.

G2 continua dependente, no mínimo, de:

- Empresa/Filial e escopo organizacional;
- usuários e memberships;
- autenticação;
- RBAC;
- enforcement de escopo organizacional;
- defesa adicional/RLS quando aplicável;
- testes cross-tenant;
- auditoria transversal.

## Fase ativa — 009 Empresa

A única etapa estrutural autorizada agora é **009 — Empresa**.

Empresa representa uma organização jurídica/operacional pertencente a exatamente um Tenant. Ela deve ser tenant-scoped desde a origem e não pode ser confundida com Tenant, Filial ou cliente comercial do TMS.

A 009 deve definir antes da migration:

- identidade UUIDv7 e business key tenant-aware;
- `tenant_id UUID NOT NULL`;
- FK tenant-aware/coerência com `organization.tenants`;
- nome empresarial e nome de exibição/fantasia somente quando justificados;
- identificador fiscal como atributo jurisdicional/configurável, sem acoplamento rígido exclusivo ao Brasil no modelo central;
- lifecycle/status e regras de ativação/inativação;
- timezone/moeda apenas quando houver override real do Tenant;
- timestamps e optimistic locking;
- unicidades tenant-aware;
- constraints, índices e validation SQL;
- domínio/persistência/testes mínimos;
- nenhuma Filial/Usuário/Membership/Auth/RBAC/RLS/Auditoria antecipada.

## Próxima transição oficial

```text
006 = CONCLUDED
G1 = APPROVED
007 = CONCLUDED
008 = CONCLUDED
009 = ACTIVE / DEFINED
010 = NOT ACTIVE
G2 = NOT APPROVED
```

A próxima unidade é implementar e evidenciar **009 — Empresa**. Somente após todos os seus quality gates:

```text
009 = CONCLUDED
010 — Filial = ACTIVE
```