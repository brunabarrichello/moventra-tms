# 008 — Tenant

## Estado

`ACTIVE / IMPLEMENTED / EVIDENCED PARCIALMENTE`

A fase foi ativada após:

```text
007 = CONCLUDED
G1 = APPROVED
```

A implementação técnica foi mergeada e a migration foi aplicada/validada em Neon `staging` e `main`. A fase ainda **não** é `CONCLUDED` porque a aplicação em Production precisa ser promovida pelo gate protegido para a mesma revisão implementada.

```text
009 = NOT ACTIVE
G2 = NOT APPROVED
```

## Objetivo

Materializar o **Tenant** como agregado raiz SaaS do Moventra TMS, com modelo relacional, invariantes, migration, validation SQL, camada de domínio/persistência mínima e testes proporcionais, sem antecipar Empresa, Filial, Usuários, Memberships, Auth, RBAC, RLS ou Auditoria.

Tenant representa o cliente/conta SaaS e define a fronteira primária de isolamento lógico da plataforma. Ele não deve ser confundido com empresa jurídica, filial, cliente comercial do TMS ou usuário.

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

A tabela física é:

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

A raiz Tenant **não** possui `tenant_id` autorreferente.

## Lifecycle aprovado

```text
PROVISIONING
ACTIVE
SUSPENDED
CLOSING
CLOSED
```

Transições implementadas:

```text
PROVISIONING -> ACTIVE | CLOSING
ACTIVE       -> SUSPENDED | CLOSING
SUSPENDED    -> ACTIVE | CLOSING
CLOSING      -> ACTIVE | CLOSED
CLOSED       -> terminal
```

Somente `ACTIVE` é considerado operacional no contrato inicial.

`SUSPENDED` é reversível. `CLOSED` é terminal. Status não é tratado como campo CRUD arbitrário.

## Concorrência

Atualizações mutáveis usam optimistic locking por `version`:

```text
WHERE id = ? AND version = expected_version
SET version = version + 1
```

Transições de status também condicionam o estado atual esperado para reduzir race conditions.

## Restrições de escopo preservadas

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

Também não alterou a migration `0001_foundation.sql`.

A validation da fase 006 foi apenas corrigida para permanecer cumulativa/forward-compatible: ela continua provando o contrato da fundação sem falsamente proibir schemas de fases posteriores depois de migrations legitimamente aplicadas. O conteúdo imutável da migration 0001 permanece protegido pelos architecture tests.

## Evidência GitHub

PR técnica:

```text
#54 — feat(tenant): implement phase 008 aggregate root
MERGED
merge commit = ca0259da26a9d57513d3aecd1c9f972413376b58
```

CI da revisão técnica anterior ao squash merge:

```text
Foundation CI
run = 32673556166
conclusion = success

Moventra CI
run = 32673556165
conclusion = success
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

O PostgreSQL migration contract comprovou:

- aplicação de `0001` + `0002` em banco PostgreSQL 18 limpo;
- reexecução sem reaplicar migrations já registradas;
- histórico/checksum imutável;
- validação cumulativa de todos os arquivos `db/validation/*_validation.sql`.

## Evidência Neon

Checksum canônico de `0002_tenant.sql`:

```text
2ceaf3d10ea4bac0c0d1d39b0638054a9409ce879156f59ef6758aef549ce875
```

### Staging

Neon branch:

```text
br-rapid-math-au6j6xut
```

Validado:

```text
organization.tenants = present
migration 0002 history = present
checksum = canonical
self tenant_id = absent
```

Smoke transacional:

```text
create -> PROVISIONING / version 1
transition -> ACTIVE / version 2
cleanup -> smoke row removed
```

### Production database

Neon `main`:

```text
br-morning-glitter-au97suq4
```

Validado:

```text
organization.tenants = present
migration 0002 history = present
checksum = canonical
self tenant_id = absent
```

Smoke transacional:

```text
create -> PROVISIONING / version 1
transition -> ACTIVE / version 2
cleanup -> smoke row removed
tenant rows after smoke = 0
```

Nenhum dado operacional real foi criado pelo smoke.

## Evidência Staging Vercel

A revisão mergeada está servindo em Staging:

```text
revision = ca0259da26a9d57513d3aecd1c9f972413376b58
/health = HTTP 200
status = ok
```

A observabilidade não mostrou erro bloqueante da fase 008. Existe um warning conhecido do `pg` relacionado à futura semântica de `sslmode=require`; ele deve ser tratado como hardening separado, não como falha do Tenant.

## Pendência para conclusão

A aplicação em **Production Vercel** ainda não foi promovida para a revisão:

```text
ca0259da26a9d57513d3aecd1c9f972413376b58
```

A promoção deve permanecer dentro do fluxo oficial:

```text
CI main
-> immutable artifact
-> staging
-> rollback/restore
-> protected production approval
-> same artifact production
-> revision identity
-> health/database readiness
-> production evidence
```

Não é permitido contornar o approval protegido com deploy manual apenas para encerrar a fase.

## Quality gate atual

- [x] modelo de Tenant revisado e compatível com `DATA-CONVENTIONS.md`;
- [x] lifecycle/status formalizado;
- [x] migration `0002` criada sem entidades 009+;
- [x] validation SQL criada e passando em banco limpo;
- [x] reexecução preserva histórico/idempotência do runner;
- [x] constraints e índices necessários validados;
- [x] camada de persistência/domínio mínima implementada;
- [x] testes de criação, leitura, atualização/versionamento e transições aplicáveis;
- [x] testes negativos de invariantes;
- [x] lint/test/build verdes;
- [x] PostgreSQL migration contract verde;
- [x] migration aplicada e validada em Neon staging;
- [x] migration aplicada e validada em Neon production/main;
- [x] staging runtime serve a revisão mergeada;
- [ ] production runtime serve a mesma revisão mergeada via gate protegido;
- [ ] evidência final de Production anexada à governança;
- [ ] fase 008 promovida formalmente para `CONCLUDED`;
- [x] nenhuma Empresa/Filial/Usuário/Membership/Auth/RBAC/RLS/Auditoria antecipada.

## Critério de promoção

Somente após os itens finais de Production/governança:

```text
008 = CONCLUDED
009 — Empresa = ACTIVE
```

Até lá:

```text
008 = ACTIVE / IMPLEMENTED
009 = NOT ACTIVE
G2 = NOT APPROVED
```

## Próxima unidade de trabalho

Concluir o **protected production promotion** da revisão `ca0259da26a9d57513d3aecd1c9f972413376b58`, validar revision identity/health/readiness e então executar a promoção documental `008 -> 009`.