# 008 — Tenant

## Estado

`CONCLUDED / IMPLEMENTED / EVIDENCED`

A fase foi concluída em 23/08/2026 após implementação, validação em PostgreSQL limpo, aplicação nas branches Neon `staging` e `main`, staging runtime, protected Production promotion e verificação operacional pós-deploy.

```text
007 = CONCLUDED
008 = CONCLUDED
009 = ACTIVE / DEFINED
G1 = APPROVED
G2 = NOT APPROVED
```

## Objetivo concluído

Materializar o **Tenant** como agregado raiz SaaS do Moventra TMS, com modelo relacional, invariantes, migration, validation SQL, camada de domínio/persistência mínima e testes proporcionais, sem antecipar Empresa, Filial, Usuários, Memberships, Auth, RBAC, RLS ou Auditoria.

Tenant representa o cliente/conta SaaS e define a fronteira primária de isolamento lógico da plataforma. Ele não se confunde com empresa jurídica, filial, cliente comercial do TMS ou usuário.

## Implementação física

Migration:

```text
db/migrations/0002_tenant.sql
```

Validation SQL:

```text
db/validation/0002_tenant_validation.sql
```

Domínio/persistência:

```text
src/modules/organization/tenant/tenant-domain.js
src/modules/organization/tenant/tenant-repository.js
```

Testes:

```text
tests/unit/tenant-domain.test.js
tests/unit/tenant-repository.test.js
tests/architecture/tenant-phase.test.js
```

Tabela:

```text
organization.tenants
```

Campos implementados:

```text
id                UUID / uuidv7()
code              business key global estável
display_name      nome de exibição
status            lifecycle explícito
default_timezone  timezone IANA no boundary da aplicação
default_currency  código de moeda de 3 letras
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
version           BIGINT / optimistic locking
```

A raiz Tenant não possui `tenant_id` autorreferente.

## Lifecycle aprovado

```text
PROVISIONING
ACTIVE
SUSPENDED
CLOSING
CLOSED
```

Transições:

```text
PROVISIONING -> ACTIVE | CLOSING
ACTIVE       -> SUSPENDED | CLOSING
SUSPENDED    -> ACTIVE | CLOSING
CLOSING      -> ACTIVE | CLOSED
CLOSED       -> terminal
```

Somente `ACTIVE` é operacional no contrato inicial. `SUSPENDED` é reversível. `CLOSED` é terminal. Status não é tratado como CRUD arbitrário.

## Concorrência

Atualizações mutáveis usam optimistic locking por `version`:

```text
WHERE id = ? AND version = expected_version
SET version = version + 1
```

Transições de status condicionam também o estado atual esperado, reduzindo race conditions.

## Escopo preservado

A fase 008 não criou:

```text
companies
branches
users
memberships
roles
permissions
sessions
audit_logs
RLS policies
```

A migration `0001_foundation.sql` permaneceu imutável. A validation da fase 006 foi apenas tornada cumulativa/forward-compatible para continuar provando o contrato técnico após migrations legítimas de fases posteriores.

## Evidência GitHub

PR técnica:

```text
#54 — feat(tenant): implement phase 008 aggregate root
MERGED
merge funcional = ca0259da26a9d57513d3aecd1c9f972413376b58
```

PR de checkpoint/governança intermediária:

```text
#55 — docs(tenant): record phase 008 implementation checkpoint
MERGED
main checkpoint = 96842a2dfd539ffac796a7f1bcfca2ad3227cc30
```

CI da revisão técnica:

```text
Foundation CI run 32673556166 = success
Moventra CI run 32673556165 = success
```

CI do checkpoint documental:

```text
Foundation CI run 32674044981 = success
Moventra CI run 32674044984 = success
```

Controles aprovados:

```text
Repository contract = success
Lint = success
Tests = success
Security baseline = success
PostgreSQL runtime dependencies = success
PostgreSQL migration contract = success
Build immutable artifact = success
CI evidence = success
```

O PostgreSQL migration contract comprovou aplicação de `0001` + `0002` em PostgreSQL 18 limpo, reexecução sem reaplicar migrations registradas, histórico/checksum imutável e validation SQL cumulativa.

## Evidência Neon

Checksum canônico de `0002_tenant.sql`:

```text
2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
```

Branches validadas:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

Em ambas:

```text
organization.tenants = present
migration 0002 history = present
checksum = canonical
self tenant_id = absent
```

Smoke transacional executado em staging e production DB:

```text
create -> PROVISIONING / version 1
transition -> ACTIVE / version 2
cleanup -> smoke row removed
```

Em production/main, `tenant_rows = 0` após o smoke. Nenhum dado operacional fictício permaneceu.

## Evidência Staging

A revisão funcional foi validada em Staging com:

```text
revision = ca0259da26a9d57513d3aecd1c9f972413376b58
/health = HTTP 200
status = ok
```

A revisão documental subsequente `96842a2dfd539ffac796a7f1bcfca2ad3227cc30` preserva o mesmo código funcional e passou novamente pela cadeia CI/staging/rollback/restore.

## Evidência Production

O gate externo de aprovação do environment `production` foi liberado e a promoção protegida prosseguiu.

Deployment observado:

```text
project = moventra-tms
deployment = dpl_9fUgkq9WjNRY7berBmKkZCQes9s6
state = READY
target = production
node = 22.x
main revision = 96842a2dfd539ffac796a7f1bcfca2ad3227cc30
```

O fluxo de Production Promotion exige a revisão corrente de `main`, artefato imutável previamente validado por rollback e verificação de revision identity antes do database readiness. Na execução observada, o deployment recebeu a sequência operacional esperada:

```text
23:43:46 GET /health = 200
23:43:48 GET /health = 200
23:43:50 GET /api/database-health = 200
23:43:53 GET /api/database-health = 200
```

A ordem `/health` antes de `/api/database-health` corresponde ao workflow fail-closed: a etapa de readiness somente é alcançada depois da verificação de revision identity. Não foram encontrados erros de runtime no projeto de Production no período pós-deploy.

## Quality gate final

- [x] modelo de Tenant revisado e compatível com `DATA-CONVENTIONS.md`;
- [x] lifecycle/status formalizado;
- [x] migration `0002` criada sem entidades 009+;
- [x] validation SQL criada e passando em banco limpo;
- [x] reexecução preserva histórico/idempotência do runner;
- [x] constraints necessárias validadas;
- [x] camada de persistência/domínio mínima implementada;
- [x] testes de criação, leitura, atualização/versionamento e transições;
- [x] testes negativos de invariantes;
- [x] lint/test/build verdes;
- [x] PostgreSQL migration contract verde;
- [x] migration aplicada e validada em Neon staging;
- [x] migration aplicada e validada em Neon production/main;
- [x] staging runtime validado;
- [x] protected Production approval respeitado;
- [x] production deployment `READY`;
- [x] production `/health` validado;
- [x] production database readiness validado;
- [x] nenhuma fase 009+ antecipada;
- [x] evidência final consolidada.

## Promoção oficial

A fase 008 atende seus critérios de promoção:

```text
008 = CONCLUDED
009 — Empresa = ACTIVE / DEFINED
```

`G2 — Security Ready` permanece `NOT APPROVED`; Tenant concluído é apenas uma dependência da sequência de segurança/organização.

## Continuidade

A próxima unidade oficial é **009 — Empresa**. A implementação deve introduzir a entidade Empresa como organização jurídica/operacional pertencente a um Tenant, obrigatoriamente tenant-aware e sem antecipar Filial, Usuários, Memberships, Auth, RBAC, RLS ou Auditoria.