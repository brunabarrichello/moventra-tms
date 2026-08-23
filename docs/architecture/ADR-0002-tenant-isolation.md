# ADR-0002 — Estratégia de isolamento multi-tenant

## Status

Aceito em 2026-08-22 para a fundação do Moventra TMS.

Revisado em 2026-08-23 para refletir a decisão de manter a migration 0001 estritamente técnica e não-domínio.

## Contexto

O Moventra TMS é SaaS multi-tenant, multiempresa e multifilial. A aplicação não pode depender apenas de filtros de interface ou de convenções informais para impedir acesso cruzado entre tenants.

## Decisão

A defesa será implementada em camadas quando as fases organizacionais e de segurança forem ativadas:

1. `tenant_id` obrigatório nas entidades tenant-scoped;
2. FKs/constraints tenant-aware para preservar coerência tenant → empresa → filial;
3. resolução explícita de contexto de tenant no backend autenticado;
4. autorização por recurso, ação e escopo organizacional;
5. RLS no PostgreSQL onde aplicável como segunda camada de defesa;
6. testes automatizados cross-tenant obrigatórios;
7. auditoria de tentativas negadas e alterações de escopo;
8. integrações e jobs carregando tenant/contexto explicitamente, sem inferência ambígua.

## Relação com a migration 0001

A migration `db/migrations/0001_foundation.sql` **não implementa Tenant, Empresa, Filial, Usuários, Memberships, RBAC, RLS ou Auditoria**.

Após a correção de governança da fase 006, o baseline 0001 cria somente infraestrutura técnica de migrations/contrato em `moventra_meta`.

As camadas desta ADR serão materializadas progressivamente nas fases oficiais:

```text
008 — Tenant
009 — Empresa
010 — Filial
011 — Usuários
012 — Memberships
013 — Auth
014 — RBAC
015 — Escopo Organizacional
016 — RLS / Defesa adicional
017 — Auditoria Central
```

A aceitação desta ADR define a **estratégia-alvo**, não comprova implementação física desses controles.

## Critério para ativar RLS

RLS somente poderá ser ativada depois de:

- existir o modelo tenant-aware necessário;
- definir a role de runtime da aplicação;
- definir como o `tenant_id` corrente é propagado para a sessão/transação PostgreSQL;
- garantir que workers, jobs e integrações usem o mesmo contrato de contexto;
- implementar testes de isolamento que provem acessos permitido e negado;
- documentar qualquer bypass administrativo e sua auditoria;
- validar que a aplicação não depende de RLS como substituto da autorização backend.

## Consequências

- reduz risco de vazamento cross-tenant;
- aumenta rigor de queries, jobs e integrações;
- exige disciplina de contexto transacional;
- evita acoplamento prematuro de RLS ao provider de autenticação;
- evita antecipar schema de segurança antes das fases correspondentes.

## Gates relacionados

- `G1 — Foundation Ready`: não depende da implementação desta ADR; foi aprovado após a conclusão das fases 001–006.
- `G2 — Security Ready`: depende da implementação e teste real de autenticação, memberships, RBAC, isolamento tenant-aware, RLS/segunda camada onde aplicável e auditoria transversal.

```text
G1 = APPROVED
G2 = NOT APPROVED
007 = ACTIVE
008+ = NOT ACTIVE até promoção sequencial
```