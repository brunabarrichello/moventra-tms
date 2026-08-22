# ADR-0002 — Estratégia de isolamento multi-tenant

## Status
Proposto para a fundação do Moventra TMS.

## Contexto
O Moventra TMS é SaaS multi-tenant, multiempresa e multifilial. A aplicação não pode depender apenas de filtros de interface ou de convenções informais para impedir acesso cruzado entre tenants.

## Decisão
A defesa será implementada em camadas:

1. `tenant_id` obrigatório nas entidades tenant-scoped;
2. FKs compostas para preservar coerência tenant → empresa → filial;
3. resolução explícita de contexto de tenant no backend autenticado;
4. autorização por recurso, ação e escopo organizacional;
5. RLS no PostgreSQL onde aplicável como segunda camada de defesa;
6. testes automatizados cross-tenant obrigatórios;
7. auditoria de tentativas negadas e alterações de escopo;
8. integrações e jobs devem carregar tenant/contexto explicitamente, nunca inferi-lo de dados globais ambíguos.

## Migration 0001
A primeira migration estabelece as fronteiras estruturais e FKs compostas. Ela **não ativa RLS ainda**, porque a política RLS depende da definição formal do contexto de execução da aplicação, roles de banco e estratégia de autenticação.

## Critério para ativar RLS
RLS só poderá ser ativado depois de:

- definir a role de runtime da aplicação;
- definir como o `tenant_id` corrente será propagado para a sessão/transação do PostgreSQL;
- garantir que workers, jobs e integrações usem o mesmo contrato de contexto;
- implementar testes de isolamento que provem acesso permitido e acesso negado;
- documentar a estratégia de bypass administrativo e sua auditoria.

## Consequências
- reduz risco de vazamento cross-tenant;
- aumenta rigor de queries e jobs;
- exige disciplina no contexto transacional;
- evita acoplamento prematuro de RLS a um provider de autenticação ainda não escolhido.

## Gate relacionado
Esta ADR é requisito para **G2 — Security Ready**, mas G2 permanece pendente até implementação e testes reais de RLS/autorização/auditoria.
