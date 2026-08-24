# 012 — Memberships

## Estado

`ACTIVE / DEFINED`

Ativada oficialmente após:

```text
011 — Usuários = CONCLUDED
G1 = APPROVED
```

Permanecem:

```text
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
G2 = NOT APPROVED
```

## Objetivo

Materializar **Membership** como vínculo explícito entre uma identidade global `User` e um `Tenant`, estabelecendo a associação organizacional mínima necessária para as fases seguintes sem antecipar autenticação, RBAC ou escopo de Empresa/Filial.

Boundary canônico:

```text
User
  = identidade global/provider-agnostic

Membership
  = vínculo User ↔ Tenant

Auth
  = provider + subject / credenciais / sessão
  = fase 013

RBAC
  = papéis/permissões
  = fase 014

Escopo Organizacional
  = acesso/assignment a Empresa e Filial
  = fase 015
```

## Decisão arquitetural

Membership é **tenant-scoped**, mas User permanece global.

A fase 012 NÃO adiciona `tenant_id` ao User e NÃO adiciona `company_id`/`branch_id` ao Membership.

Isso preserva:

- uma única identidade User para múltiplos Tenants;
- isolamento tenant-aware no vínculo;
- independência entre membership e autorização por escopo;
- evolução posterior de RBAC e escopos sem remodelar a identidade global.

## Modelo relacional alvo

Tabela:

```text
identity.memberships
```

Estrutura:

| Campo | Regra |
|---|---|
| `id` | `UUID NOT NULL DEFAULT uuidv7()`; PK imutável |
| `tenant_id` | `UUID NOT NULL`; boundary SaaS |
| `user_id` | `UUID NOT NULL`; identidade global associada |
| `status` | lifecycle explícito |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `version` | `BIGINT NOT NULL DEFAULT 1`; optimistic locking |

Chaves/índices mínimos:

```text
PK (id)
FK tenant_id -> organization.tenants(id)
FK user_id -> identity.users(id)
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, user_id)
INDEX (tenant_id, status)
INDEX (user_id, status)
```

`UNIQUE (tenant_id, id)` prepara referências futuras tenant-aware. `UNIQUE (tenant_id, user_id)` garante um único Membership canônico por User/Tenant.

## Cardinalidade

```text
User 1 ───── 0..N Membership
Tenant 1 ─── 0..N Membership
```

Um User pode participar de múltiplos Tenants. Um Tenant pode possuir múltiplos Users por Membership.

## Lifecycle

Estados:

```text
PENDING
ACTIVE
SUSPENDED
REVOKED
```

Transições:

```text
PENDING   -> ACTIVE | REVOKED
ACTIVE    -> SUSPENDED | REVOKED
SUSPENDED -> ACTIVE | REVOKED
REVOKED   -> terminal
```

Semântica:

- `PENDING`: associação registrada, ainda não operacional; não implica convite ou autenticação;
- `ACTIVE`: associação operacional;
- `SUSPENDED`: bloqueio reversível da associação no Tenant;
- `REVOKED`: encerramento terminal da associação.

Ativação exige simultaneamente:

```text
Tenant.status = ACTIVE
User.status = ACTIVE
```

Membership `ACTIVE` não concede permissão de negócio por si só; RBAC permanece fase 014.

## Concorrência e integridade

Toda mutação usa optimistic locking:

```text
WHERE tenant_id = ?
  AND id = ?
  AND version = expected_version
SET version = version + 1
```

Ativação deve revalidar `Tenant.status = ACTIVE` e `User.status = ACTIVE` de forma atômica na mesma atualização, evitando race condition entre leitura de pré-condições e transição.

`tenant_id` e `user_id` são imutáveis. Mover Membership entre Tenant ou User não é update comum.

## Persistência

Repository esperado:

```text
src/modules/identity/membership/membership-repository.js
```

Operações mínimas:

```text
create(tenantId, userId)
findById(tenantId, id)
findByUserId(tenantId, userId)
transitionStatus(tenantId, id, toStatus, expectedVersion)
```

Toda leitura/mutação de Membership deve exigir `tenant_id` explícito. Não oferecer lookup de negócio por `membership_id` isolado.

Para administração global futura, queries cross-tenant devem existir em adapter/repository explícito e protegido, não reutilizar métodos tenant-scoped de forma ambígua.

## Domínio

Arquivo esperado:

```text
src/modules/identity/membership/membership-domain.js
```

Responsabilidades:

- validar lifecycle;
- expor `isMembershipOperational`;
- validar pré-condições de ativação;
- normalizar expected version;
- produzir erros estáveis `MVT_MEMBERSHIP_*`.

## Não escopo

A fase 012 NÃO cria:

```text
invitations
external_identities
auth_accounts
passwords
credentials
sessions
refresh_tokens
roles
permissions
role_assignments
company_scope_assignments
branch_scope_assignments
RLS policies
audit_logs
```

Também não adiciona `company_id` ou `branch_id` a `identity.memberships`.

## Segurança e LGPD

- Membership referencia `User` por UUID e não deve duplicar e-mail/PII;
- UUID não é autorização;
- `tenant_id` vindo do cliente não substitui contexto autorizado;
- futura API deve ocultar existência de Membership cross-tenant;
- nenhuma credencial ou token deve existir na tabela;
- revogação preserva histórico por status terminal, não hard delete operacional.

## Migration esperada

```text
db/migrations/0006_membership.sql
```

Validation SQL:

```text
db/validation/0006_membership_validation.sql
```

Migration 0006 deve criar somente artefatos da fase 012 e não alterar migrations 0001–0005 já aplicadas.

## Testes mínimos

### Domínio

- lifecycle válido/inválido;
- `REVOKED` terminal;
- somente `ACTIVE` operacional;
- Tenant não ativo impede ativação;
- User não ativo impede ativação;
- expected version positivo.

### Persistência

- create tenant-scoped;
- duplicidade User/Tenant rejeitada;
- mesmo User em Tenants diferentes permitido;
- find por id exige tenant correto;
- find por user exige tenant correto;
- tenant incorreto não descobre Membership;
- optimistic locking;
- stale version rejeitada;
- ativação atômica exige Tenant e User ACTIVE;
- `tenant_id` e `user_id` imutáveis.

### Banco/arquitetura

- migration 0006 aplica após 0001–0005 em PostgreSQL 18;
- reexecução preserva migration history;
- validation SQL passa;
- `identity.memberships` existe;
- `tenant_id` e `user_id` são UUID NOT NULL;
- FKs para Tenant e User existem;
- `UNIQUE (tenant_id, id)` existe;
- `UNIQUE (tenant_id, user_id)` existe;
- `company_id`/`branch_id` não existem;
- nenhuma tabela Auth/RBAC/RLS/Audit é criada.

## Quality gates

A fase somente pode ser concluída quando:

- [ ] boundary User/Membership/Auth/RBAC/Escopo revisado;
- [ ] lifecycle formalizado;
- [ ] activation preconditions formalizadas;
- [ ] migration `0006_membership.sql` implementada;
- [ ] validation SQL implementada;
- [ ] migration validada em PostgreSQL 18 após 0001–0005;
- [ ] reexecução/histórico idempotente validado;
- [ ] domínio/persistência implementados;
- [ ] optimistic locking validado;
- [ ] testes cross-tenant e negativos aprovados;
- [ ] lint/test/build verdes;
- [ ] PostgreSQL migration contract verde;
- [ ] migration aplicada e validada em Neon Staging/Main;
- [ ] staging runtime validado;
- [ ] rollback/restore validado;
- [ ] protected Production promotion concluída sem bypass;
- [ ] Production revision identity/health/readiness validados;
- [ ] documentação/issue atualizadas;
- [ ] nenhuma fase 013+ antecipada.

## Critério de promoção

Somente após todos os quality gates:

```text
012 = CONCLUDED
013 — Auth = ACTIVE / DEFINED
```

Até lá:

```text
012 = ACTIVE
013 = NOT ACTIVE
G2 = NOT APPROVED
```
