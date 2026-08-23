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
| 004 — CI/CD | **CONCLUDED** | build-once, artefato imutável, staging, rollback/restore, production protegida, revision identity e evidence validados; promotion run `32662438316` attempt 3 = success |
| 005 — Secrets Management | **CONCLUDED** | stores segregados, credenciais por ambiente, least privilege e governança de secrets validados |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, baseline técnico 0001, migration framework, runtime least privilege e readiness validados; `B006-02 = RESOLVED` |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico em `docs/data/DATA-CONVENTIONS.md`, guardrails em `tests/architecture/data-conventions.test.js`, PR #51 mergeada e CI verde |
| 008 — Tenant | **ACTIVE / IMPLEMENTED / EVIDENCED PARCIALMENTE** | PR #54 mergeada; migration 0002 e domínio/persistência implementados; CI verde; Neon staging/main com `organization.tenants`; staging runtime na revisão `ca0259...`; falta protected Production promotion da mesma revisão |
| 009 — Empresa | **NOT ACTIVE / DEFINED** | nenhuma entidade criada; depende da conclusão formal de Tenant |
| 010 — Filial | **NOT ACTIVE / DEFINED** | nenhuma entidade criada; depende de Empresa |
| 011 — Usuários | **NOT ACTIVE / DEFINED** | identidade de negócio ainda não implementada no banco |
| 012 — Memberships | **NOT ACTIVE / DEFINED** | vínculo usuário ↔ tenant/empresa/filial ainda não implementado |
| 013 — Auth | **NOT ACTIVE / DEFINED** | provider não deve contaminar a identidade de negócio; implementação posterior |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | autorização backend e modelo físico ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | enforcement tenant/company/branch será posterior a RBAC/memberships |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | ADR-0002 vigente; RLS somente após contrato de contexto e testes cross-tenant |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada |

## Banco — estado confirmado após implementação da 008

Neon PostgreSQL:

```text
PostgreSQL = 18.6
TimeZone = GMT
migration 0001 = present
migration 0002 = present
organization.tenants = present
```

Migration 0002:

```text
name = 0002_tenant.sql
checksum = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
```

A migration foi aplicada e validada nas branches:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

Em ambas:

- `organization.tenants` existe;
- a raiz Tenant não possui `tenant_id` autorreferente;
- smoke transacional create → transition/version → cleanup passou;
- nenhum registro operacional de smoke permaneceu;
- nenhuma entidade 009+ foi criada.

## Gate G1 — Foundation Ready

`G1 = APPROVED` em 23/08/2026.

G1 aprovou a fundação técnica e permanece vigente.

## 007 — evidência de conclusão

```text
PR #51
merge commit = 46e08ce5cefe2c5d3df9eb89bcaee096dc9f9fa5
Foundation CI run = 32672159870 / success
Moventra CI run = 32672159907 / success
```

## 008 — evidência técnica atual

PR técnica:

```text
#54 — feat(tenant): implement phase 008 aggregate root
merge commit = ca0259da26a9d57513d3aecd1c9f972413376b58
```

Quality gates da revisão técnica:

```text
Foundation CI run 32673556166 = success
Moventra CI run 32673556165 = success
```

O Moventra CI aprovou:

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

Staging Vercel está servindo:

```text
/health = HTTP 200
version = ca0259da26a9d57513d3aecd1c9f972413376b58
```

A aplicação em Production ainda não foi promovida para essa revisão pelo gate protegido. Portanto a fase 008 **não** é `CONCLUDED`.

## Gate G2 — Security Ready

`G2 = NOT APPROVED`.

G2 continua dependente, no mínimo, de:

- Tenant concluído/governado;
- Empresa/Filial e escopo organizacional conforme sequência;
- usuários e memberships;
- autenticação;
- RBAC;
- enforcement de escopo organizacional;
- defesa adicional/RLS quando aplicável;
- testes cross-tenant;
- auditoria transversal.

## Próxima transição oficial

Estado atual:

```text
006 = CONCLUDED
G1 = APPROVED
007 = CONCLUDED
008 = ACTIVE / IMPLEMENTED
009 = NOT ACTIVE
G2 = NOT APPROVED
```

Próxima ação permitida:

**finalizar o protected Production promotion da revisão `ca0259da26a9d57513d3aecd1c9f972413376b58` e consolidar a evidência da 008.**

Somente depois:

```text
008 = CONCLUDED
009 — Empresa = ACTIVE
```

Empresa e todas as etapas seguintes permanecem não ativas até essa promoção formal.