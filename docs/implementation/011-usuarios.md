# 011 — Usuários

## Estado

`CONCLUDED`

A fase 011 materializou a identidade humana/de negócio global e provider-agnostic do Moventra TMS sem antecipar Membership, Auth, RBAC, RLS ou Auditoria.

Estado subsequente:

```text
011 — Usuários = CONCLUDED
012 — Memberships = ACTIVE / DEFINED
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
G2 = NOT APPROVED
```

## Boundary consolidado

```text
User
  = identidade humana/de negócio canônica e global

Membership
  = vínculo User ↔ Tenant
  = fase 012

Auth / External Identity
  = vínculo provider + subject / credenciais / sessão
  = fase 013
```

`identity.users` não possui `tenant_id`, `company_id`, `branch_id`, provider subject, password hash ou session.

## Implementação

Tabela:

```text
identity.users
```

Migration/validation:

```text
db/migrations/0005_user.sql
db/validation/0005_user_validation.sql
```

Domínio/persistência:

```text
src/modules/identity/user/user-domain.js
src/modules/identity/user/user-repository.js
```

Contrato principal:

```text
id UUID DEFAULT uuidv7()
primary_email global/canônico/unique
display_name
preferred_locale opcional
preferred_timezone opcional
PENDING / ACTIVE / SUSPENDED / CLOSED
optimistic locking por version
```

Lifecycle:

```text
PENDING   -> ACTIVE | CLOSED
ACTIVE    -> SUSPENDED | CLOSED
SUSPENDED -> ACTIVE | CLOSED
CLOSED    -> terminal
```

## Evidência de conclusão

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

O CI aprovou Repository contract, PostgreSQL runtime dependencies, Security baseline, Lint, Tests, PostgreSQL migration contract, Build immutable artifact e CI evidence.

Neon Staging/Main:

```text
identity.users = present
migration 0005 checksum = 11a1c01962f68e04b4519172f6526ee0646e13fdcec142ef4842ea3ea3db8f60
primary_email unique = present
sem tenant/company/branch = validated
smoke create PENDING -> ACTIVE/version 2 -> cleanup = success
```

Staging:

```text
revision = 4e4c2c7d3e88d1676a1da52da0dc39d1c555467d
health = 200
database readiness = 200
rollback/restore = validated
```

Production protegida:

```text
deployment = dpl_3rvaEkC4PaRTGPCtqc55yijPfcQf
state = READY
target = production
stable /health = 200
stable revision = 4e4c2c7d3e88d1676a1da52da0dc39d1c555467d
stable /api/database-health = 200 / ready
runtime errors pós-promoção = none observed
```

Não houve bypass do environment protegido.

## Segurança/LGPD

`primary_email` permanece classificado como PII. A tabela User não contém credenciais. APIs futuras devem evitar user enumeration; retention/anonymization deve preservar obrigações históricas e legais.

## Resultado

Todos os quality gates da 011 foram satisfeitos e evidenciados.

```text
011 = CONCLUDED
012 — Memberships = ACTIVE / DEFINED
```
