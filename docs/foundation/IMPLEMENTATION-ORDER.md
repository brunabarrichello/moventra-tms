# Continuidade da Fundação — Linha Oficial de Implantação

A fundação do Moventra TMS deve seguir esta sequência sem antecipar módulos de negócio:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Auth → RBAC → Isolamento → Auditoria**

## Estado atual

| Etapa | Estado |
|---|---|
| Governança | em implementação; baseline versionada |
| Arquitetura | monólito modular formalizado em ADR |
| Ambientes | matriz documentada; Neon possui main/development/staging |
| CI/CD | CI mínimo de fundação criado; CD depende do runtime/deploy oficial |
| Secrets | política versionada; secret store ainda depende dos ambientes de aplicação |
| Banco base | projeto Neon provisionado; schema base ainda não aplicado |
| Convenções | baseline de dados versionada |
| Tenant | modelagem preparada, implementação pendente |
| Empresa | pendente |
| Filial | pendente |
| Usuários | pendente |
| Auth | pendente; provider/estratégia ainda deve ser formalizado |
| RBAC | modelo conceitual definido; schema pendente |
| Isolamento | política definida; testes/RLS pendentes |
| Auditoria | requisitos definidos; schema e interceptação pendentes |

## Gate G1 — Foundation Ready
Não considerar concluído até existirem arquitetura aprovada, ambientes de aplicação segregados, CI/CD operacional, banco versionado/migration framework e secrets configurados.

## Gate G2 — Security Ready
Não considerar concluído até autenticação, memberships, RBAC, isolamento tenant-aware, testes cross-tenant e auditoria transversal estarem implementados e testados.
