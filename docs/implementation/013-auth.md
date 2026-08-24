# 013 — Auth

## Estado

`ACTIVE / BATCH 012–017`

A execução técnica está autorizada sem promoção intermediária de Production. A fase somente será marcada `CONCLUDED` no fechamento da 017 após evidência Production do conjunto.

## Decisão

Auth permanece provider-agnostic. `User` é a identidade canônica global; `ExternalIdentity` mapeia uma identidade técnica verificada de um provider para um User; `Membership` determina participação em um Tenant.

```text
verified provider assertion
→ provider_key + issuer + subject
→ ExternalIdentity ACTIVE
→ User ACTIVE
→ Membership ACTIVE no Tenant solicitado
→ Auth principal resolvido
```

## Modelo

`identity.external_identities`:
- UUIDv7;
- `user_id` imutável;
- `provider_key`, `issuer`, `subject`;
- unique `(provider_key, issuer, subject)`;
- lifecycle `ACTIVE ↔ DISABLED`;
- optimistic locking;
- sem `tenant_id`, senha, token ou sessão.

## Segurança

O core não confia em claims não verificadas. Verificação criptográfica de JWT/OIDC/SAML pertence ao adapter do provider. O adapter deve entregar ao core somente uma assertion verificada. Tokens e credenciais não são persistidos na tabela de identidade externa.

## Não escopo

RBAC = 014; escopo Company/Branch = 015; RLS = 016; auditoria = 017.

## Gate

CI + PostgreSQL 18 + Neon Staging devem estar verdes. Production permanece deferida até a 017 conforme Issue #69.
