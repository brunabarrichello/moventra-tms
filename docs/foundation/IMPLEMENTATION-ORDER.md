# Continuidade da Fundação — Linha Oficial de Implantação

A fundação do Moventra TMS deve seguir esta sequência sem antecipar módulos de negócio:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Auth → RBAC → Isolamento → Auditoria**

## Estado atual

| Etapa | Estado |
|---|---|
| Governança | baseline versionada na branch `foundation/governance` |
| Arquitetura | monólito modular formalizado em ADR |
| Ambientes | matriz documentada; Neon possui `main`, `development` e `staging`; ambientes completos de aplicação ainda pendentes |
| CI/CD | CI mínimo de fundação criado; CD depende do runtime/deploy oficial |
| Secrets | política versionada; secret store ainda depende dos ambientes de aplicação |
| Banco base | Neon PostgreSQL 18.6 provisionado; migration `db/migrations/0001_foundation.sql` preparada e ainda não promovida para `main` |
| Convenções | baseline versionada; UUIDv7 nativo validado no PostgreSQL 18.6 |
| Tenant | schema estrutural preparado na migration 0001 |
| Empresa | schema estrutural preparado na migration 0001 |
| Filial | schema estrutural preparado na migration 0001 |
| Usuários | usuário de negócio e identidades externas separados na migration 0001 |
| Auth | provider ainda não escolhido; modelagem permanece desacoplada do fornecedor |
| RBAC | roles, permissions, role_permissions e membership_roles preparados na migration 0001 |
| Isolamento | escopo tenant/empresa/filial reforçado por FKs compostas; RLS e testes cross-tenant permanecem pendentes |
| Auditoria | `audit_logs` e proteção append-only preparados na migration 0001; interceptação transversal da aplicação ainda pendente |

## Validação da migration 0001

O arquivo `db/validation/0001_foundation_validation.sql` contém verificações somente leitura para schemas, tabelas, constraints, índices, defaults UUIDv7 e trigger append-only.

A migration deve ser executada e validada primeiro em branch temporária Neon. Promoção para `main` exige aprovação explícita.

## Gate G1 — Foundation Ready

Não considerar concluído até existirem arquitetura aprovada, ambientes de aplicação segregados, CI/CD operacional, banco versionado/migration framework e secrets configurados.

## Gate G2 — Security Ready

Não considerar concluído até autenticação, memberships, RBAC, isolamento tenant-aware, testes cross-tenant e auditoria transversal estarem implementados e testados.
