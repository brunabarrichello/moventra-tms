# Fundação de Segurança — Tenant, Escopo, RBAC e Auditoria

## Status do documento

`TARGET DESIGN / PARTIALLY IMPLEMENTED`

As fases 008–011 estão concluídas. A fase 012 — Memberships está ativa. Auth/RBAC/Escopo/RLS/Auditoria permanecem não implementados.

Estado canônico:

```text
G1 = APPROVED
008 = CONCLUDED
009 = CONCLUDED
010 = CONCLUDED
011 = CONCLUDED
012 = ACTIVE / DEFINED
013–017 = NOT ACTIVE / NOT IMPLEMENTED
G2 = NOT APPROVED
```

## Hierarquia e identidade implementadas

```text
Tenant → Empresa → Filial
User = identidade global/provider-agnostic
```

Estruturas existentes:

```text
organization.tenants
organization.companies
organization.branches
identity.users
```

## Membership — decisão da fase 012

Membership materializa exclusivamente o vínculo entre um `User` global e um `Tenant`.

Princípios obrigatórios:

```text
Membership é tenant-scoped
um User pode participar de múltiplos Tenants
um User possui no máximo um Membership por Tenant
Membership não duplica dados do User
Membership não contém company_id/branch_id nesta fase
Membership não contém roles/permissões
Membership não contém provider subject, credential ou session
```

A fase 012 deverá materializar:

```text
identity.memberships
```

Contrato mínimo:

```text
id UUID / uuidv7()
tenant_id UUID NOT NULL
user_id UUID NOT NULL
UNIQUE (tenant_id, user_id)
UNIQUE (tenant_id, id)
status PENDING / ACTIVE / SUSPENDED / REVOKED
optimistic locking
```

Ativação exige `Tenant.status = ACTIVE` e `User.status = ACTIVE`.

## Auth — princípio alvo

A futura fase 013 mapeará `provider + provider_subject` para o User canônico sem transformar o provider na PK do domínio e sem contaminar Membership com credenciais/sessões.

## Autorização — princípio alvo

A autorização deverá combinar:

1. identidade autenticada;
2. User operacional;
3. Tenant operacional;
4. Membership ACTIVE;
5. roles/permissões;
6. escopo organizacional;
7. regras específicas do domínio.

Nenhuma autorização crítica depende somente do frontend ou de UUID fornecido pelo cliente.

## RBAC e Escopo Organizacional

RBAC permanece fase 014. Escopos de Empresa/Filial e assignments correspondentes permanecem fase 015.

A decisão de manter `company_id`/`branch_id` fora de `identity.memberships` na 012 evita antecipar o modelo de escopo organizacional e permite evolução independente de memberships e autorizações.

## Isolamento em profundidade

A estratégia da ADR-0002 permanece:

1. contexto de Tenant obrigatório para recursos tenant-scoped;
2. constraints/FKs tenant-aware;
3. Membership/RBAC e escopo organizacional;
4. RLS onde aplicável como defesa adicional;
5. testes cross-tenant automatizados;
6. auditoria de decisões sensíveis e tentativas negadas.

## PII

`identity.users.primary_email` é PII. Membership referencia o User por UUID e não deve duplicar e-mail ou outros dados pessoais sem justificativa.

## Auditoria — princípio alvo

A futura Auditoria Central deverá registrar ator/User, Tenant, Empresa/Filial quando aplicável, ação, entidade, before/after com redaction, correlation IDs, origem, resultado e timestamp.

## Sequência oficial relacionada

```text
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = CONCLUDED
012 — Memberships = ACTIVE
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
```

## Gate G2

`G2 — Security Ready = NOT APPROVED`.

Continua pendente até existirem e forem testados, no mínimo, Memberships, Auth, RBAC aplicado no backend, escopo organizacional, defesa adicional/RLS quando aplicável, testes de autorização/cross-tenant e auditoria transversal.
