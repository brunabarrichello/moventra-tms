# 013 — Auth

## Estado

`CONCLUDED`

Concluída no fechamento conjunto do batch 012–017 após promoção Production protegida da revisão funcional final.

## Decisão arquitetural

Auth permanece provider-agnostic. `User` é a identidade canônica global; `ExternalIdentity` mapeia uma identidade técnica verificada de um provider para um User; `Membership` determina participação em um Tenant.

```text
verified provider assertion
→ provider_key + issuer + subject
→ ExternalIdentity ACTIVE
→ User ACTIVE
→ Membership ACTIVE no Tenant solicitado
→ principal autenticado resolvido
```

O core não confia em claims não verificadas. A verificação criptográfica de JWT/OIDC/SAML pertence ao adapter do provider. O adapter entrega ao core somente assertion já verificada e claims minimizados.

## Modelo implementado

`identity.external_identities`:

- UUIDv7;
- `user_id` imutável;
- `provider_key`, `issuer`, `subject`;
- `UNIQUE (provider_key, issuer, subject)`;
- lifecycle `ACTIVE ↔ DISABLED`;
- timestamps e optimistic locking;
- sem `tenant_id`, senha, access token, refresh token ou sessão.

Entidade global e provider-agnostic; vínculo organizacional continua exclusivamente em Membership.

## Migration

```text
migration = db/migrations/0007_external_identity.sql
checksum  = 1fc9db5b61796d29e5b98b57231e5973a05758ff8b1bcef2b0c58ff80c4fa6b0
```

Aplicada primeiro em Neon Staging e posteriormente promovida em ordem para Neon Main no gate final do batch.

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

A fase foi concluída conjuntamente com 012 e 014–017 conforme Issue #69; não houve deploy Production intermediário específico da 013.

## Critérios finais atendidos

- [x] identidade externa desacoplada de Tenant e de fornecedor específico;
- [x] resolução User + Membership operacional tenant-aware;
- [x] nenhum secret/token/session persistido;
- [x] conflitos e lifecycle testados;
- [x] CI e PostgreSQL migration contract verdes;
- [x] Neon Staging/Main validados;
- [x] staging/rollback/restore e Production protegida evidenciados no batch final;
- [x] revisão funcional, health/readiness e observabilidade comprovados.
