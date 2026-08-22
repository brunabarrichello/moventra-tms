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
| 004 — CI/CD | IMPLEMENTED / EVIDENCED / REMEDIATED / REEXECUTION REQUIRED | CI, build-once, artifact imutável, staging, rollback/restore e deployment produtivo foram comprovados. O Production Promotion automático executou preflight + approval + exact artifact + deploy, mas falhou no smoke do alias protegido por defeito técnico posteriormente corrigido. Uma nova cadeia completa deve terminar `success` e produzir production evidence antes de `CONCLUDED`. |
| 005 — Secrets Management | DEFINED / NOT ACTIVE | política versionada; a etapa só pode ser promovida após 004 = CONCLUDED |
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

Portanto, as etapas 008–017 não podem ser classificadas como implementadas apenas porque a migration 0001 contém suas estruturas.

## Revisões obrigatórias antes da etapa 006

Antes da promoção da migration 0001 devem ser resolvidos formalmente:

1. lifecycle de tenant;
2. lifecycle de usuário;
3. identidade polimórfica de ator em auditoria;
4. eventos de auditoria platform-scoped/pré-tenant;
5. redaction/minimização de JSONB de auditoria;
6. migration runner/processo de promoção e evidência.

## Gate G1 — Foundation Ready

`G1` permanece **NOT APPROVED**.

Para aprovação ainda são necessários, no mínimo:

- concluir formalmente 004 com nova Production Promotion `success`, approval history e production evidence artifact;
- executar a etapa 005 — Secrets Management conforme governança oficial;
- executar e validar a etapa 006 — Banco Base por processo de migration governado;
- confirmar os demais requisitos da fundação antes da promoção do gate.

## Gate G2 — Security Ready

`G2` permanece **NOT APPROVED** até autenticação, memberships, RBAC, isolamento tenant-aware, RLS/segunda camada onde aplicável, testes cross-tenant e auditoria transversal estarem implementados e testados.

## Próxima transição permitida

```text
004 corrected main execution
→ Moventra CI success
→ staging success
→ rollback/restore success
→ protected production approval
→ exact immutable artifact production deploy
→ immutable + stable production smoke success
→ production evidence artifact + approval-history.json
→ 004 = CONCLUDED
→ 005 = ACTIVE
```

Nenhuma etapa posterior deve ser antecipada.
