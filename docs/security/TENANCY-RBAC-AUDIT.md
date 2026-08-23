# Fundação de Segurança — Tenant, Escopo, RBAC e Auditoria

## Status do documento

`TARGET DESIGN / NOT IMPLEMENTED`

Este documento descreve o modelo de segurança organizacional planejado para as fases 008–017. Ele **não representa schema atualmente existente** no banco.

Estado canônico em 23/08/2026:

```text
G1 = APPROVED
007 = ACTIVE
008–017 = NOT ACTIVE / NOT IMPLEMENTED
G2 = NOT APPROVED
```

## Hierarquia organizacional alvo

```text
Tenant → Empresa → Filial
```

O tenant será a fronteira primária de isolamento. Empresas e filiais serão escopos organizacionais internos do tenant, não substitutos do tenant.

## Estado físico atual do banco

A migration `db/migrations/0001_foundation.sql` é deliberadamente não-domínio e contém somente metadados técnicos da fundação em `moventra_meta`.

No encerramento da fase 006:

```text
organization schema = absent
identity schema = absent
audit schema = absent
public business tables = 0
```

Portanto, os nomes de entidades abaixo são **modelo futuro**, não tabelas implementadas.

## Entidades estruturais planejadas

Quando suas fases forem ativadas, a modelagem deverá contemplar, sem antecipação indevida:

- Tenant;
- Company/Empresa;
- Branch/Filial;
- User;
- identidades externas do usuário quando necessárias;
- Membership;
- Role;
- Permission;
- relação Role ↔ Permission;
- atribuição de Role ao membership/escopo;
- Audit Log transversal.

Os nomes físicos, schemas, constraints e detalhes finais serão definidos pelas migrations de cada fase, sob as convenções oficiais vigentes.

## Usuário e identidade — princípio alvo

A identidade de negócio do Moventra deve permanecer desacoplada da conta técnica de um provider de autenticação.

Quando implementado, o vínculo externo deve permitir mapear `provider + provider_subject` para a identidade de negócio sem tornar o provider a PK canônica do domínio.

## Membership — princípio alvo

Usuário e tenant devem ser relacionados por membership explícito.

O membership poderá possuir escopo no tenant, empresa ou filial conforme as regras aprovadas. Relações organizacionais deverão preservar coerência tenant-aware por constraints/FKs e autorização backend.

## Autorização — princípio alvo

A autorização deverá combinar:

1. identidade autenticada;
2. tenant ativo;
3. membership válida;
4. roles/permissões;
5. escopo organizacional;
6. regras específicas do recurso/domínio.

Nenhuma autorização crítica dependerá somente do frontend.

## RBAC — princípio alvo

Permissões devem representar ações de negócio atômicas, por exemplo:

```text
operations.trip.read
operations.trip.update
finance.payment.approve
```

Roles deverão ser atribuídas dentro de escopo organizacional explícito e não poderão conceder acesso cross-tenant por acidente.

## Isolamento em profundidade — estratégia aprovada

A estratégia definida na ADR-0002 é:

1. contexto de tenant obrigatório no backend;
2. constraints/FKs tenant-aware;
3. RBAC e escopo organizacional;
4. RLS onde aplicável como segunda camada;
5. testes cross-tenant automatizados;
6. auditoria de decisões sensíveis e tentativas negadas.

RLS não será ativada antes da existência do modelo tenant-aware, contrato de contexto transacional e testes correspondentes.

## Auditoria — princípio alvo

A futura auditoria transversal deverá registrar, quando aplicável:

- ator;
- tenant;
- empresa/filial;
- ação;
- entidade;
- before/after com redaction;
- request/correlation/transaction IDs;
- origem;
- IP/user agent quando pertinente;
- motivo;
- resultado;
- timestamp.

A implementação deverá diferenciar:

- Audit Trail;
- Security Audit;
- Operational Event Log;
- Financial/Fiscal Ledger.

Financeiro e Fiscal não devem depender de uma tabela de auditoria genérica para representar ledger.

## Sequência oficial relacionada

```text
007 — Convenções de Dados = ACTIVE
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

Nenhuma fase posterior deve ser marcada como implementada apenas porque este target design existe.

## Gate G2

`G2 — Security Ready` permanece pendente até existirem e forem testados:

- autenticação;
- memberships;
- RBAC aplicado no backend;
- isolamento tenant-aware;
- RLS/segunda camada onde aplicável;
- testes cross-tenant;
- auditoria transversal;
- testes de autorização e auditoria.
