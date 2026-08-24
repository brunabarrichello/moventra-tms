# Fundação de Segurança — Tenant, Escopo, RBAC e Auditoria

## Status do documento

`TARGET DESIGN / PARTIALLY IMPLEMENTED`

Este documento descreve o modelo de segurança organizacional das fases 008–017. As fases 008–010 estão concluídas; 011 — Usuários está ativa. Memberships/Auth/RBAC/Escopo/RLS/Auditoria ainda não estão implementados.

Estado canônico:

```text
G1 = APPROVED
008 = CONCLUDED
009 = CONCLUDED
010 = CONCLUDED
011 = ACTIVE / DEFINED
012–017 = NOT ACTIVE / NOT IMPLEMENTED
G2 = NOT APPROVED
```

## Hierarquia organizacional implementada

```text
Tenant → Empresa → Filial
```

O Tenant é a fronteira primária de isolamento SaaS. Empresas e Filiais são escopos organizacionais internos e preservam coerência tenant-aware por constraints/FKs compostas.

Estruturas existentes:

```text
organization.tenants
organization.companies
organization.branches
```

## Usuário e identidade — decisão da fase 011

A identidade de negócio do Moventra permanece desacoplada de Tenant e da conta técnica de um provider de autenticação.

A fase 011 deverá materializar:

```text
identity.users
```

Princípios obrigatórios:

```text
User é identidade global do SaaS
User não possui tenant_id/company_id/branch_id
User não armazena password/session/provider_subject
User pode futuramente participar de múltiplos Tenants via Membership
```

A identidade externa futura deverá mapear `provider + provider_subject` para o User canônico sem tornar o provider a PK do domínio. Esse vínculo pertence à fase 013 — Auth.

## Membership — princípio alvo

Usuário e Tenant serão relacionados por Membership explícito na fase 012.

O Membership poderá possuir escopo organizacional no Tenant, Empresa ou Filial conforme regras aprovadas. Relações deverão preservar coerência tenant-aware por constraints/FKs e autorização no backend.

Não adicionar `tenant_id` diretamente ao User para simular Membership.

## Autorização — princípio alvo

A autorização deverá combinar:

1. identidade autenticada;
2. User operacional;
3. Tenant operacional;
4. Membership válida;
5. roles/permissões;
6. escopo organizacional;
7. regras específicas do recurso/domínio.

Nenhuma autorização crítica dependerá somente do frontend ou de UUID fornecido pelo cliente.

## RBAC — princípio alvo

Permissões representam ações de negócio atômicas, por exemplo:

```text
operations.trip.read
operations.trip.update
finance.payment.approve
```

Roles deverão ser atribuídas dentro de escopo organizacional explícito e não poderão conceder acesso cross-tenant por acidente.

## Isolamento em profundidade

A estratégia definida na ADR-0002 permanece:

1. contexto de Tenant obrigatório no backend onde o recurso for tenant-scoped;
2. constraints/FKs tenant-aware;
3. Membership/RBAC e escopo organizacional;
4. RLS onde aplicável como defesa adicional;
5. testes cross-tenant automatizados;
6. auditoria de decisões sensíveis e tentativas negadas.

As fases 009/010 já materializam parte do item 2. RLS não será ativada antes da existência do modelo de contexto/autorização e testes correspondentes.

## PII de User

`primary_email` de `identity.users` será PII.

Regras alvo:

- minimização de dados;
- não registrar e-mail completo desnecessariamente em logs;
- nenhuma credencial na tabela de User;
- APIs futuras devem evitar user enumeration;
- retenção/anonymization deverão respeitar LGPD e integridade histórica;
- alteração/verificação de e-mail relacionada à autenticação deve ser tratada na fase Auth, sem acoplar a PK do User ao provider.

## Auditoria — princípio alvo

A futura Auditoria Central deverá registrar, quando aplicável:

- ator/User;
- Tenant;
- Empresa/Filial;
- ação;
- entidade;
- before/after com redaction;
- request/correlation/transaction IDs;
- origem;
- IP/user agent quando pertinente;
- motivo;
- resultado;
- timestamp.

A implementação diferenciará Audit Trail, Security Audit, Operational Event Log e ledgers Financeiro/Fiscal.

## Sequência oficial relacionada

```text
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = ACTIVE
012 — Memberships = NOT ACTIVE
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
```

Nenhuma fase posterior deve ser marcada como implementada apenas porque o target design existe.

## Gate G2

`G2 — Security Ready = NOT APPROVED`.

Continua pendente até existirem e forem testados, no mínimo:

- Users;
- Memberships;
- autenticação;
- RBAC aplicado no backend;
- escopo organizacional;
- defesa adicional/RLS onde aplicável;
- testes cross-tenant e de autorização;
- auditoria transversal.
