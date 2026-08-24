# 014 — RBAC

## Estado

`ACTIVE / BATCH 012–017`

A implementação técnica está autorizada sem promoção intermediária de Production. `CONCLUDED` depende da evidência Production final do batch na 017.

## Objetivo

Materializar autorização por permissões de negócio no backend, tenant-aware e desacoplada da identidade/autenticação.

```text
Auth principal
→ User ACTIVE
→ Membership ACTIVE
→ Role assignment ACTIVE no mesmo Tenant
→ Role ACTIVE
→ Permission ACTIVE
→ autorização da ação
```

## Modelo

- `security.permissions`: catálogo global de permissões atômicas e estáveis, por exemplo `operations.trip.read` e `finance.payment.approve`;
- `security.roles`: papéis configuráveis por Tenant;
- `security.role_permissions`: composição Role → Permission com coerência tenant-aware;
- `security.membership_roles`: atribuição Membership → Role no mesmo Tenant, revogável e versionada.

## Invariantes

- autorização crítica é executada no backend;
- nenhuma Role ou atribuição cruza Tenants;
- Membership, Tenant e User devem estar operacionais;
- Role e Permission devem estar ativas;
- ausência de grant resulta em deny;
- UUID vindo do cliente nunca é prova de autorização;
- escopo Empresa/Filial não é antecipado nesta fase.

## Concorrência e revogação

Atribuições usam optimistic locking e lifecycle `ACTIVE → REVOKED`. Uma atribuição ativa duplicada para a mesma Membership/Role é impedida pelo banco.

## Não escopo

- Company/Branch scope = 015;
- RLS = 016;
- Auditoria Central = 017.

## Gate técnico

Migration/validation PostgreSQL 18, domínio/repository, serviço de autorização, testes negativos/cross-tenant e CI devem estar verdes. Neon Staging deve receber a migration. Production permanece deferida conforme Issue #69.
