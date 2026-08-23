# ADR-0002 — Estratégia de isolamento multi-tenant

## Status

Aceito em 2026-08-22 para a fundação do Moventra TMS.

Revisado em 2026-08-23 para refletir:

- migration 0001 estritamente técnica e não-domínio;
- conclusão da fase 007 — Convenções de Dados;
- implementação física inicial do agregado raiz Tenant na fase 008.

## Contexto

O Moventra TMS é SaaS multi-tenant, multiempresa e multifilial. A aplicação não pode depender apenas de filtros de interface ou de convenções informais para impedir acesso cruzado entre tenants.

## Decisão

A defesa será implementada em camadas conforme as fases organizacionais e de segurança forem ativadas:

1. `tenant_id` obrigatório nas entidades tenant-scoped;
2. FKs/constraints tenant-aware para preservar coerência tenant → empresa → filial;
3. resolução explícita de contexto de tenant no backend autenticado;
4. autorização por recurso, ação e escopo organizacional;
5. RLS no PostgreSQL onde aplicável como segunda camada de defesa;
6. testes automatizados cross-tenant obrigatórios;
7. auditoria de tentativas negadas e alterações de escopo;
8. integrações e jobs carregando tenant/contexto explicitamente, sem inferência ambígua.

## Implementação progressiva

A migration `db/migrations/0001_foundation.sql` **não implementa Tenant, Empresa, Filial, Usuários, Memberships, RBAC, RLS ou Auditoria**. Ela permanece o baseline técnico em `moventra_meta`.

As camadas desta ADR são materializadas progressivamente nas fases:

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

A aceitação da ADR define a estratégia-alvo; cada camada somente pode ser considerada implementada quando houver evidência da sua fase.

## Estado da fase 008

A fase 008 introduziu fisicamente a raiz SaaS:

```text
organization.tenants
```

pela migration:

```text
db/migrations/0002_tenant.sql
```

A raiz Tenant **não possui `tenant_id` autorreferente**. Essa ausência é intencional: o Tenant é a própria fronteira raiz; entidades tenant-scoped das fases posteriores é que carregarão `tenant_id`.

A implementação atual inclui:

- PK UUID com `uuidv7()` quando gerada no PostgreSQL;
- business key `code` separada da PK;
- lifecycle explícito;
- timezone e moeda padrão mínimos;
- timestamps técnicos;
- optimistic locking por `version`;
- constraints de integridade;
- camada de domínio/persistência mínima;
- architecture tests proibindo antecipação de fases 009+.

Isso **não** significa que autorização multi-tenant esteja pronta. Ainda não existem Empresa, Filial, Usuários, Memberships, Auth, RBAC, propagação de tenant context, RLS ou auditoria transversal.

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
- evita antecipar schema de segurança antes das fases correspondentes;
- estabelece Tenant como raiz organizacional sem confundi-lo com Empresa.

## Gates relacionados

- `G1 — Foundation Ready`: aprovado e vigente;
- `G2 — Security Ready`: continua dependente da implementação e teste real das fases organizacionais/de segurança seguintes.

Estado atual:

```text
G1 = APPROVED
G2 = NOT APPROVED
007 = CONCLUDED
008 = ACTIVE / IMPLEMENTED
009+ = NOT ACTIVE até promoção sequencial
```

A fase 008 somente será promovida para `CONCLUDED` após a evidência final de Production e governança correspondente.