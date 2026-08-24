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

## Estado canônico

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | governança, histórico e processo de mudança versionados |
| 002 — Arquitetura Base | **CONCLUDED** | monólito modular vigente |
| 003 — Ambientes | **CONCLUDED** | ambientes segregados |
| 004 — CI/CD | **CONCLUDED** | build-once, staging, rollback/restore, Production protegida e revision identity validados |
| 005 — Secrets Management | **CONCLUDED** | stores segregados e least privilege |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, migration framework e runtime least privilege |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico e guardrails |
| 008 — Tenant | **CONCLUDED** | raiz SaaS materializada |
| 009 — Empresa | **CONCLUDED** | organização tenant-aware materializada |
| 010 — Filial | **CONCLUDED** | unidade tenant/company-aware materializada |
| 011 — Usuários | **CONCLUDED** | identidade global/provider-agnostic materializada e promovida em Production |
| 012 — Memberships | **ACTIVE / DEFINED** | vínculo User ↔ Tenant autorizado; sem Auth/RBAC/escopo company/branch |
| 013 — Auth | **NOT ACTIVE / DEFINED** | external identity/credentials/session dependem de Membership |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | papéis/permissões ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | assignments company/branch posteriores a RBAC |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | defesa adicional após contexto/autorização |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada |

## Banco — estado após 011

```text
PostgreSQL = 18.6
migration 0001 = present
migration 0002 = present
migration 0003 = present
migration 0004 = present
migration 0005 = present
organization.tenants = present
organization.companies = present
organization.branches = present
identity.users = present
identity.memberships = absent até implementação da 012
```

Checksums canônicos:

```text
0002_tenant.sql  = 2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
0003_company.sql = 149bf9550606dd864e42a7955949ac37f3703be20432eea045b7375089de248a
0004_branch.sql  = ae678058e2adb0f58e116f2e665e4f7a0f3526034313ce08b69c4e889cb69802
0005_user.sql    = 11a1c01962f68e04b4519172f6526ee0646e13fdcec142ef4842ea3ea3db8f60
```

Neon:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = NOT APPROVED
```

G2 permanece pendente até Memberships, Auth, RBAC, Escopo Organizacional, defesa adicional/RLS quando aplicável, testes de autorização/cross-tenant e Auditoria Central estarem concluídos.

## 011 — Usuários concluída

PR técnica:

```text
#64 — feat(user): implement phase 011 global provider-agnostic user
merge funcional = 4e4c2c7d3e88d1676a1da52da0dc39d1c555467d
```

CI:

```text
Foundation CI 32680722912 = success
Moventra CI 32680722872 = success
```

Neon Staging/Main:

```text
identity.users = present
migration 0005 checksum = 11a1c01962f68e04b4519172f6526ee0646e13fdcec142ef4842ea3ea3db8f60
UNIQUE primary_email = present
sem tenant_id/company_id/branch_id = validated
smoke PENDING -> ACTIVE/version 2 + cleanup = success
```

Production:

```text
deployment = dpl_3rvaEkC4PaRTGPCtqc55yijPfcQf
state = READY
target = production
stable GET /health = 200
revision = 4e4c2c7d3e88d1676a1da52da0dc39d1c555467d
stable GET /api/database-health = 200 / ready
runtime errors pós-promoção = none observed
```

Conclusão:

```text
011 = CONCLUDED
```

## Fase ativa — 012 Memberships

Membership é o agregado de associação entre uma identidade global `User` e um `Tenant`.

Decisão canônica desta fase:

```text
User = global ao SaaS
Membership = tenant-scoped
um User pode possuir memberships em vários Tenants
um User possui no máximo um Membership por Tenant
Membership NÃO contém company_id/branch_id nesta fase
Membership NÃO contém roles/permissões
Membership NÃO contém provider subject, password ou session
```

Modelo alvo:

```text
identity.memberships
id UUID / uuidv7()
tenant_id UUID NOT NULL
user_id UUID NOT NULL
status PENDING / ACTIVE / SUSPENDED / REVOKED
created_at / updated_at
version BIGINT
UNIQUE (tenant_id, user_id)
UNIQUE (tenant_id, id)
FK tenant_id -> organization.tenants(id)
FK user_id -> identity.users(id)
```

Ativação exige simultaneamente:

```text
Tenant.status = ACTIVE
User.status = ACTIVE
```

Repository deve ser sempre tenant-scoped. O Membership não deve resolver autenticação, autorização RBAC ou escopo de Empresa/Filial; essas responsabilidades permanecem nas fases 013–015.

## Próxima transição oficial

```text
011 = CONCLUDED
012 = ACTIVE / DEFINED
013 = NOT ACTIVE
G2 = NOT APPROVED
```

Somente após todos os quality gates de Memberships:

```text
012 = CONCLUDED
013 — Auth = ACTIVE / DEFINED
```

## Regra de revision identity

A revisão funcional/runtime que conclui uma fase é registrada separadamente da revisão documental que promove a etapa seguinte. Commits exclusivamente documentais posteriores não reabrem fase funcional já promovida e evidenciada em Production.
