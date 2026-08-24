# 012 — Memberships

## Estado

`CONCLUDED`

Concluída no fechamento conjunto do batch 012–017 após promoção Production protegida da revisão funcional final.

## Objetivo e boundary canônico

Membership materializa o vínculo explícito entre uma identidade global `User` e um `Tenant` sem duplicar identidade por organização.

```text
User = identidade global/provider-agnostic
Membership = vínculo User ↔ Tenant
Auth = identidade técnica de provider — fase 013
RBAC = papéis/permissões — fase 014
Escopo Organizacional = acesso a Empresa/Filial — fase 015
```

A fase não adiciona `tenant_id` ao User nem `company_id`/`branch_id` ao Membership.

## Modelo implementado

`identity.memberships` possui:

- UUID/UUIDv7 como PK;
- `tenant_id UUID NOT NULL`;
- `user_id UUID NOT NULL`;
- `UNIQUE (tenant_id, id)`;
- `UNIQUE (tenant_id, user_id)`;
- FKs para Tenant e User;
- lifecycle `PENDING / ACTIVE / SUSPENDED / REVOKED`;
- timestamps e optimistic locking por `version`.

Lifecycle:

```text
PENDING   → ACTIVE | REVOKED
ACTIVE    → SUSPENDED | REVOKED
SUSPENDED → ACTIVE | REVOKED
REVOKED   → terminal
```

Ativação exige Tenant e User `ACTIVE` e revalida ambos atomicamente na mutação. Membership `ACTIVE` por si só não concede permissão de negócio.

## Persistência e segurança

Repositories de negócio exigem Tenant explícito para leitura e mutação. O mesmo Membership ID sob Tenant incorreto não é descoberto. `tenant_id` e `user_id` são imutáveis; mutações usam optimistic locking.

Nenhuma credencial, token, Role, Permission ou escopo de Empresa/Filial pertence à tabela.

## Migration

```text
migration = db/migrations/0006_membership.sql
checksum  = 1196de78f64408d34f3e6353a57e0d68b9d39a51fb4c31a3d2ad9d684985806c
```

Aplicada e validada em Neon Staging e Main.

## Evidência de conclusão

```text
batch functional/runtime revision = 6b80fe7903b5ba742041508cb7465ff529215139
final Foundation CI              = success (#206)
final Moventra CI                = success (#201)
Production deployment            = dpl_EHVA4pRhCchcn6Nrn43uTefpUuue
Production state                 = READY
/health                          = 200 × 2
/api/database-health             = 200 × 2
runtime errors                   = none observed
```

A fase foi concluída conjuntamente com 013–017 sob a autorização de batch registrada na Issue #69; não houve deploy Production intermediário específico da 012.

## Quality gates finais

- [x] boundary User/Membership/Auth/RBAC/Escopo revisado;
- [x] lifecycle e activation preconditions formalizados;
- [x] migration e validation implementadas;
- [x] PostgreSQL 18 / migration history validados;
- [x] domínio/persistência e optimistic locking implementados;
- [x] testes cross-tenant, negativos e de concorrência aprovados;
- [x] lint/test/build e PostgreSQL contract verdes;
- [x] Neon Staging/Main validados;
- [x] staging runtime, rollback/restore e artifact identity validados no batch final;
- [x] Production protegida concluída sem bypass;
- [x] revision identity, health, database readiness e runtime errors validados;
- [x] governança final registrada.
