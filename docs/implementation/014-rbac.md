# 014 — RBAC

## Estado

`CONCLUDED`

Concluída no fechamento conjunto do batch 012–017 após promoção Production protegida da revisão funcional final.

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

## Modelo implementado

- `security.permissions`: catálogo global de permissões atômicas e estáveis;
- `security.roles`: papéis configuráveis por Tenant;
- `security.role_permissions`: composição Role → Permission com coerência tenant-aware;
- `security.membership_roles`: atribuição Membership → Role no mesmo Tenant, revogável e versionada.

## Invariantes de autorização

- autorização crítica é executada no backend;
- nenhuma Role ou atribuição cruza Tenants;
- Membership, Tenant e User devem estar operacionais;
- Role e Permission devem estar ativas;
- ausência de grant resulta em deny;
- UUID fornecido pelo cliente não é autorização;
- escopo Empresa/Filial é resolvido separadamente pela fase 015.

Atribuições possuem lifecycle `ACTIVE → REVOKED`, optimistic locking e unicidade de atribuição ativa Membership/Role.

## Migration

```text
migration = db/migrations/0008_rbac.sql
checksum  = 9071eccc4f7e1a80f4f2ab27bee0e75d1dc84f9e5de52dc36645bce78ca0e6f1
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

A fase foi concluída conjuntamente com 012–013 e 015–017, sem deploy Production intermediário específico da 014.

## Critérios finais atendidos

- [x] permission catalog global e roles/grants tenant-scoped;
- [x] backend deny-by-default;
- [x] coerência tenant-aware por constraints e queries;
- [x] lifecycle/revogação e optimistic locking;
- [x] testes negativos/cross-tenant aprovados;
- [x] CI e PostgreSQL contract verdes;
- [x] Neon Staging/Main validados;
- [x] staging/rollback/restore e Production protegida evidenciados no batch final;
- [x] health/readiness e ausência de runtime errors comprovados.
