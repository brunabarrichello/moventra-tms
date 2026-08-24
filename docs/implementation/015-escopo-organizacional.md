# 015 — Escopo Organizacional

## Estado

`CONCLUDED`

Concluída no fechamento conjunto do batch 012–017 após promoção Production protegida da revisão funcional final.

## Objetivo

Aplicar permissões RBAC a alvos organizacionais explícitos dentro do Tenant sem confiar em IDs fornecidos pelo cliente.

## Hierarquia e modelo

```text
TENANT
└── COMPANY
    └── BRANCH
```

`security.organizational_scopes` materializa alvos TENANT/COMPANY/BRANCH com FKs compostas tenant-aware. `security.role_assignment_scopes` liga atribuições RBAC a um ou mais alvos válidos.

Semântica de cobertura:

- TENANT cobre qualquer Empresa/Filial do mesmo Tenant;
- COMPANY cobre a Empresa e suas Filiais;
- BRANCH cobre somente a Filial exata;
- atribuição sem scope não concede acesso organizacional;
- o backend carrega o recurso persistido e deriva o scope efetivo a partir dos dados confiáveis.

## Segurança

A decisão de acesso combina User/Membership operacionais, RBAC ativo e scope organizacional. Cross-tenant e cross-company são impedidos por constraints compostas, queries tenant-aware e testes negativos. UUID isolado não é autorização.

## Migration

```text
migration = db/migrations/0009_organizational_scope.sql
checksum  = eb9a820934b70305a50bd30a1b3a01c9aca033387e0fea09543dd25eee2748af
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

A fase foi concluída conjuntamente com 012–014 e 016–017, sem deploy Production intermediário específico da 015.

## Critérios finais atendidos

- [x] hierarchy Tenant/Company/Branch formalizada;
- [x] FKs compostas tenant-aware implementadas;
- [x] assignments RBAC ligados a scopes explícitos;
- [x] unscoped assignment não concede resource scope;
- [x] testes de hierarquia, cross-tenant e cross-company aprovados;
- [x] CI e PostgreSQL contract verdes;
- [x] Neon Staging/Main validados;
- [x] staging/rollback/restore e Production protegida evidenciados no batch final.
