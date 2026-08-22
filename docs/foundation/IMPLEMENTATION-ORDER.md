# Continuidade da Fundação — Linha Oficial de Implantação

A fundação do Moventra TMS deve seguir esta sequência sem antecipar módulos de negócio:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Auth → RBAC → Isolamento → Auditoria**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidade e critérios documentados;
- **PREPARED** — artefato técnico existe, porém ainda não foi promovido/ativado;
- **IMPLEMENTED** — código ou infraestrutura existem fisicamente;
- **EVIDENCED** — execução real foi observada e validada;
- **CONCLUDED** — implementação, validação e evidência do gate foram formalmente aprovadas.

A existência de schema, migration, workflow ou documento não promove automaticamente uma etapa para `CONCLUDED`.

## Estado auditado em 2026-08-22

| Etapa | Estado | Evidência / decisão atual |
|---|---|---|
| 001 — Governança | IMPLEMENTED / EVIDENCED | identidade oficial, governança, CODEOWNERS, PRs e histórico versionados em `main` |
| 002 — Arquitetura Base | IMPLEMENTED / EVIDENCED | ADR-0001 aceito; monólito modular é a arquitetura inicial oficial |
| 003 — Ambientes | IMPLEMENTED PARCIAL / EVIDENCED | Neon possui `main`, `development` e `staging`; Vercel possui projetos físicos de staging e production; ambiente dedicado de aplicação para development ainda não está formalmente evidenciado |
| 004 — CI/CD | IMPLEMENTED / EVIDÊNCIA FÍSICA AVANÇADA / FECHAMENTO FORMAL PENDENTE | CI, lint, testes, build-once, artifact imutável, staging, rollback/restore e deployment produtivo da revisão atual foram observados; ainda falta correlacionar formalmente a promoção produtiva ao approval/evidence artifact do workflow protegido |
| 005 — Secrets Management | DEFINED / NOT ACTIVE | política versionada e CI rejeita materiais sensíveis; a etapa não pode ser promovida antes do encerramento formal da 004 |
| 006 — Banco Base | PREPARED / NOT ACTIVE | Neon PostgreSQL 18.6 provisionado; `0001_foundation.sql` está no Git, porém a branch Neon `main` não contém os schemas/tabelas da fundação |
| 007 — Convenções de Dados | DEFINED / PREPARED | baseline versionada; aplicação definitiva ao schema depende da 006 |
| 008 — Tenant | PREPARED ONLY | estrutura existe apenas na migration 0001 ainda não aplicada; lifecycle requer revisão antes da 006 |
| 009 — Empresa | PREPARED ONLY | estrutura existe apenas na migration 0001 ainda não aplicada |
| 010 — Filial | PREPARED ONLY | estrutura existe apenas na migration 0001 ainda não aplicada |
| 011 — Usuários | PREPARED ONLY | modelo de usuário/identidade existe apenas na migration 0001 ainda não aplicada; lifecycle requer revisão |
| 012 — Memberships | PREPARED ONLY | schema preparado, não implementado no banco produtivo |
| 013 — Auth | DEFINED / PENDING | provider não escolhido; identidade de negócio permanece desacoplada do fornecedor |
| 014 — RBAC | PREPARED ONLY | tabelas preparadas na migration; autorização backend ainda não implementada |
| 015 — Escopo Organizacional | DEFINED / PREPARED | FKs tenant-aware preparadas; enforcement no backend ainda pendente |
| 016 — RLS / Defesa adicional | DEFINED / PENDING | ADR-0002 aceita; RLS não deve ser ativada antes do contrato de contexto e dos testes cross-tenant |
| 017 — Auditoria Central | PREPARED ONLY | tabela append-only preparada; interceptação transversal, política de redaction e trilhas de aplicação ainda pendentes |

## Evidência do banco

A verificação somente leitura da branch Neon `main` em 2026-08-22 confirmou:

```text
PostgreSQL = 18.6
organization schema = absent
identity schema     = absent
audit schema        = absent
foundation tables   = 0
```

Portanto, as etapas 008–017 **não podem ser classificadas como implementadas** apenas porque a migration 0001 contém suas estruturas.

## Revisões obrigatórias antes da etapa 006

A auditoria atual identificou pontos que devem ser corrigidos antes da promoção da migration 0001:

1. alinhar lifecycle de tenant ao fluxo oficial (`PROVISIONING`, `ACTIVE`, `SUSPENDED`, `CLOSING`, `CLOSED`) ou registrar ADR que justifique alternativa;
2. alinhar lifecycle de usuário (`INVITED`, `ACTIVE`, `LOCKED`, `SUSPENDED`, `DISABLED`) e evitar duplicar soft delete como status de negócio;
3. corrigir a modelagem de `audit.audit_logs.actor_id`, pois `actor_type` aceita atores que não são `identity.users`;
4. permitir eventos de auditoria de escopo de plataforma/pré-tenant de forma controlada, sem enfraquecer o isolamento tenant-scoped;
5. formalizar política de redaction/minimização para `previous_data`, `new_data` e `metadata`;
6. adotar e evidenciar um migration runner/processo de promoção, além de manter SQL versionado e validação somente leitura.

Nenhuma dessas correções autoriza aplicar a migration antes da ativação da etapa 006.

## Gate G1 — Foundation Ready

`G1` permanece **NOT APPROVED**.

Para aprovação ainda são necessários, no mínimo:

- concluir formalmente 004 com evidence/approval correlacionados;
- executar a etapa 005 na ordem oficial;
- revisar, validar e promover a etapa 006 por processo governado;
- confirmar o fechamento dos requisitos de ambientes da fundação.

## Gate G2 — Security Ready

`G2` permanece **NOT APPROVED** e não deve ser antecipado. Depende da implementação real de autenticação, memberships, RBAC backend, isolamento tenant-aware/RLS onde aplicável, testes cross-tenant e auditoria transversal.

## Próxima ação permitida

```text
fechar evidência formal da 004
→ 004 = CONCLUDED
→ ativar 005
```

Não promover 006 ou qualquer etapa posterior antes disso.
