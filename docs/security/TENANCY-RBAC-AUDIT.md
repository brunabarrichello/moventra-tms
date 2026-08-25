# Fundação de Segurança — Tenant, Auth, Escopo, RBAC, RLS e Auditoria

## Status do documento

`IMPLEMENTED / VERIFIED THROUGH PHASE 018`

Este documento descreve o boundary de segurança efetivamente implementado do Moventra TMS. A versão anterior estava historicamente defasada e ainda apresentava Memberships como fase ativa; esta revisão sincroniza o documento com o estado real já comprovado por código, migrations, CI, Neon e Production.

Estado canônico:

```text
G1 = APPROVED
G2 = APPROVED / REVALIDATED AFTER P0 + P1
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = CONCLUDED
012 — Memberships = CONCLUDED
013 — Auth = CONCLUDED
014 — RBAC = CONCLUDED
015 — Escopo Organizacional = CONCLUDED
016 — RLS / Defesa adicional = CONCLUDED
017 — Auditoria Central = CONCLUDED
018 — Configurações = CONCLUDED
019 — Feature Flags = ACTIVE / DEFINED
```

## Hierarquia organizacional

```text
Tenant
└── Company
    └── Branch
```

Estruturas principais:

```text
organization.tenants
organization.companies
organization.branches
```

FKs compostas tenant-aware impedem relacionamento de Company/Branch com outro Tenant.

## Identidade global

```text
User = identidade de negócio global/provider-agnostic
ExternalIdentity = provider + issuer + subject → User
```

Estruturas:

```text
identity.users
identity.external_identities
```

`User` não possui `tenant_id`. Identidade do provedor externo não é PK do domínio. Dados de autenticação não são misturados com Membership.

## Membership

`identity.memberships` materializa o vínculo entre User global e Tenant.

Princípios vigentes:

```text
Membership é tenant-scoped
um User pode participar de múltiplos Tenants
no máximo um Membership por User/Tenant
Membership não duplica PII do User
Membership não incorpora provider credential/session
```

O escopo Empresa/Filial é modelado separadamente no domínio de Organizational Scope.

## Auth

A autenticação resolve uma assertion já verificada por adapter confiável para `ExternalIdentity`, `User` e Membership operacional.

Nenhum header, UUID ou subject recebido diretamente do cliente é tratado como prova de identidade sem verificação do provider adapter.

## RBAC

O modelo combina catálogo global de permissões com roles e assignments tenant-scoped.

```text
User autenticado
→ Membership ACTIVE
→ Role/grant do Tenant
→ Permission
→ Organizational Scope
→ regra específica do domínio
```

Autorização crítica é sempre aplicada no backend e é deny-by-default.

## Escopo Organizacional

A cobertura de recursos pode ser Tenant, Company ou Branch. O request pode informar o alvo, mas o backend comprova que o principal possui scope suficiente e que as FKs pertencem ao mesmo Tenant.

```text
scope TENANT  → cobre o Tenant
scope COMPANY → cobre a Company alvo conforme regra de domínio
scope BRANCH  → cobre a Branch alvo
```

## RLS — defesa adicional

RLS é segunda camada de isolamento e nunca substitui Auth/Membership/RBAC/Scope.

O contexto tenant-aware é transaction-local:

```text
set_config('moventra.tenant_id', tenantId, true)
security.current_tenant_id()
```

A aplicação usa principal PostgreSQL non-owner e `NOBYPASSRLS` para que as policies sejam efetivamente aplicáveis.

## Runtime PostgreSQL least privilege

O hardening P0 comprovou que o runtime:

- não é superuser;
- não é owner das estruturas de domínio;
- não possui BYPASSRLS;
- não possui CREATE nos schemas de domínio;
- não possui acesso à metadata de migrations;
- não possui DELETE indiscriminado;
- recebe somente SELECT/INSERT/UPDATE/EXECUTE necessários por tabela/função.

O contrato versionado está em `db/runtime/runtime-access.sql`.

## Pipeline integrado P1

Boundary reutilizável:

```text
verified provider assertion
→ ExternalIdentity ACTIVE
→ User ACTIVE
→ Membership ACTIVE no Tenant
→ RBAC permission
→ Organizational Scope
→ transaction-local Tenant context
→ RLS defense-in-depth
→ operação de domínio
→ Audit SUCCESS
→ COMMIT
```

Implementação canônica: `AuthorizedTenantOperationService`.

Regras:

- Auth/Membership/RBAC/Scope/operação/Audit usam a mesma transação no caminho autorizado;
- `SUCCESS` é auditado atomicamente com a mutação;
- `DENIED`/`FAILED` são registrados conforme contrato após rollback, sem mascarar o erro original;
- cross-tenant deve permanecer invisível/bloqueado.

## Auditoria Central

`audit.audit_events` é tenant-scoped, protegido por RLS e append-only.

Registra, conforme aplicável:

```text
actor
Tenant
Company/Branch
operation/action
entity/resource
request/correlation
result
reason
occurred_at
metadata minimizada/redigida
```

Audit Trail, Security Audit, Operational Event Log e futuros ledgers financeiro/fiscal possuem responsabilidades distintas; o audit central não deve ser usado como ledger contábil/fiscal.

## Configurações — fase 018

O subsistema de configurações reutiliza integralmente o boundary de segurança.

```text
configuration.definitions      = global, sem RLS tenant-based
configuration.settings         = tenant-scoped + RLS
configuration.setting_versions = tenant-scoped + RLS + append-only
```

Permissões:

```text
configuration.settings.read
configuration.settings.manage
```

Precedência operacional:

```text
BRANCH > COMPANY > TENANT > DEFINITION_DEFAULT
```

A migration `0012_configuration.sql` foi validada em Neon Staging/Main e Production. Cross-tenant read foi comprovado como zero sob principal de aplicação, e a ACL mantém history sem UPDATE/DELETE.

## Dados sensíveis e LGPD

`identity.users.primary_email` é PII. Dados pessoais devem ser minimizados, não duplicados sem necessidade e redigidos em logs/auditoria quando aplicável.

O domínio Configurações não armazena:

```text
passwords
tokens
API keys
private keys
DATABASE_URL
credentials de providers/bancos/gateways
```

Secrets continuam exclusivamente no Secrets Management.

## Isolamento em profundidade

A estratégia vigente combina:

1. contexto Tenant obrigatório para recursos tenant-scoped;
2. constraints/FKs tenant-aware;
3. Auth + Membership + RBAC;
4. Organizational Scope;
5. RLS quando aplicável;
6. principal PostgreSQL least-privilege/NOBYPASSRLS;
7. testes cross-tenant automatizados e reais;
8. auditoria de operações sensíveis e tentativas negadas.

## Revisões canônicas

```text
P0 runtime least privilege = 8c17e8c2c101c6e5c3bda3c5870e86a9136d43a8
P1 pipeline integrado      = 0a0ec943cc249e635d94267f386bb638228e11f7
018 functional revision    = 81b7edf3571aa5e3b37ce81c42ef6f4bf5311359
018 Production deployment  = dpl_ELC7hjcG2rCCJY2mA4vGWwmuYZdT
```

## Próxima etapa

A segurança 008–018 permanece vigente e deve ser reutilizada pela **019 — Feature Flags**. Feature flag controla exposição/rollout de funcionalidade e **nunca substitui autorização**. A fase 020 permanece inativa até conclusão da 019.