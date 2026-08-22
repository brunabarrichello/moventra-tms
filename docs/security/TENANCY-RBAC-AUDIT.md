# Fundação de Segurança — Tenant, Escopo, RBAC e Auditoria

## Hierarquia organizacional
`Tenant → Empresa → Filial`

O tenant é a fronteira primária de isolamento. Empresas e filiais são escopos organizacionais internos do tenant, não substitutos do tenant.

A migration `db/migrations/0001_foundation.sql` estabelece a primeira defesa estrutural com FKs compostas para impedir combinações incoerentes entre tenant, empresa e filial.

## Entidades estruturais iniciais
- `organization.tenants`;
- `organization.companies`;
- `organization.branches`;
- `identity.users`;
- `identity.user_identities`;
- `identity.memberships`;
- `identity.roles`;
- `identity.permissions`;
- `identity.role_permissions`;
- `identity.membership_roles`;
- `audit.audit_logs`.

## Usuário e identidade
`identity.users` representa o usuário de negócio do Moventra e não deve ser confundido com a conta técnica de um provider de autenticação.

`identity.user_identities` liga o usuário a identidades externas por `provider + provider_subject`. Isso permite trocar ou combinar provedores sem alterar o identificador de negócio do usuário.

## Membership
Usuário e tenant são relacionados por membership explícito. Uma mesma identidade pode, quando autorizada, participar de diferentes tenants sem compartilhar dados entre eles.

O membership pode possuir escopo:
- no tenant inteiro;
- em uma empresa;
- em uma filial.

Uma filial exige empresa correspondente, e as FKs compostas preservam o mesmo tenant.

## Autorização
A autorização deve combinar:
1. identidade autenticada;
2. tenant ativo;
3. membership válida;
4. permissões do papel;
5. escopo organizacional;
6. regras específicas do recurso/domínio.

Nenhuma autorização crítica deve depender somente do frontend.

## RBAC
O RBAC inicial utiliza:
- `identity.permissions` — catálogo global de permissões atômicas;
- `identity.roles` — papéis configuráveis por tenant;
- `identity.role_permissions` — permissões atribuídas aos papéis;
- `identity.membership_roles` — papéis atribuídos ao membership organizacional.

Permissions devem representar ações de negócio, por exemplo `operations.trip.read`, `operations.trip.update` ou `finance.payment.approve`.

## Isolamento em profundidade
A estratégia oficial é defense-in-depth:
1. contexto de tenant obrigatório no backend;
2. constraints/FKs tenant-aware no banco;
3. RBAC e escopo organizacional;
4. RLS onde aplicável;
5. testes cross-tenant automatizados;
6. auditoria das decisões sensíveis e tentativas negadas.

A ativação de RLS está deliberadamente separada da migration 0001 e depende da definição da role de runtime, propagação transacional de `tenant_id` e estratégia de bypass administrativo auditado. Ver `docs/architecture/ADR-0002-tenant-isolation.md`.

## Auditoria
`audit.audit_logs` registra a trilha transversal inicial com ator, tenant, empresa/filial quando aplicável, ação, entidade, before/after, request/correlation/transaction IDs, IP, user agent, motivo, resultado e timestamp.

A migration 0001 define a tabela como append-only no banco, bloqueando UPDATE e DELETE por trigger.

## Separação de trilhas
- Audit Trail: mudanças de negócio;
- Security Audit: autenticação, privilégios, bloqueios e acessos suspeitos;
- Operational Event Log: eventos operacionais de carga/viagem/tracking;
- Financial/Fiscal Ledger: eventos imutáveis ou reversíveis por lançamento compensatório.

Financeiro e Fiscal futuramente terão ledgers/eventos específicos e não devem depender apenas de `audit_logs`.

## Gate G2
G2 — Security Ready continua pendente até existirem:
- autenticação implementada;
- RBAC aplicado no backend;
- RLS/segunda camada de isolamento validada onde aplicável;
- testes cross-tenant;
- auditoria transversal da aplicação;
- testes de autorização e auditoria.
