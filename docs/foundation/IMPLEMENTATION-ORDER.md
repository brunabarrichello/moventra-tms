# Continuidade da Fundação — Linha Oficial de Implantação

A fundação do Moventra TMS segue esta sequência sem antecipar módulos de negócio:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS/Defesa adicional → Auditoria**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidade e critérios documentados;
- **ACTIVE** — etapa oficialmente autorizada para execução;
- **PREPARED** — artefato técnico existe, mas a etapa ainda não está concluída;
- **IMPLEMENTED** — código ou infraestrutura existem fisicamente;
- **EVIDENCED** — execução real foi observada e validada;
- **CONCLUDED** — implementação, validação, evidência e governança do gate foram aprovadas.

A existência de schema, migration, workflow ou documento não promove automaticamente uma etapa para `CONCLUDED`.

## Estado canônico em 23/08/2026

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | identidade oficial, governança, CODEOWNERS, histórico e processo de mudança versionados |
| 002 — Arquitetura Base | **CONCLUDED** | ADR-0001 aceito; monólito modular permanece arquitetura inicial oficial |
| 003 — Ambientes | **CONCLUDED** | Development segregado por branch/configuração e execução local/efêmera; Test no CI; staging e production em projetos Vercel separados; Neon segregado por branches |
| 004 — CI/CD | **CONCLUDED** | build-once, artefato imutável, staging, rollback/restore, production protegida, revision identity e production evidence validados; run `32662438316` attempt 3 = success |
| 005 — Secrets Management | **CONCLUDED** | stores segregados, credenciais por ambiente, política/CI e cutover operacional validados; risco do token legado permanece explicitamente aceito e não bloqueante |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, baseline técnico 0001, migration framework, least privilege, runtime pool e readiness 200 em staging e production; `B006-02 = RESOLVED` |
| 007 — Convenções de Dados | **ACTIVE / DEFINED** | `docs/data/DATA-CONVENTIONS.md` existe; fase autorizada a transformar convenções em contrato verificável antes de iniciar Tenant |
| 008 — Tenant | **NOT ACTIVE / DEFINED** | nenhuma entidade criada no banco; execução depende da conclusão da 007 |
| 009 — Empresa | **NOT ACTIVE / DEFINED** | nenhuma entidade criada; depende de Tenant |
| 010 — Filial | **NOT ACTIVE / DEFINED** | nenhuma entidade criada; depende de Empresa |
| 011 — Usuários | **NOT ACTIVE / DEFINED** | identidade de negócio ainda não implementada no banco |
| 012 — Memberships | **NOT ACTIVE / DEFINED** | vínculo usuário ↔ tenant/empresa/filial ainda não implementado |
| 013 — Auth | **NOT ACTIVE / DEFINED** | provider não deve contaminar a identidade de negócio; implementação posterior |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | autorização backend e modelo físico ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | enforcement tenant/company/branch será posterior a RBAC/memberships |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | ADR-0002 vigente; RLS somente após contrato de contexto e testes cross-tenant |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada; não há tabela de auditoria antecipada no baseline 0001 |

## Banco base — estado confirmado

Verificação somente leitura de 23/08/2026 em Neon `main`:

```text
PostgreSQL = 18.6
TimeZone = GMT
moventra_meta.schema_migrations = present
moventra_meta.database_contract = present
public base tables = 0
migration 0001 records = 1
```

A branch `staging` apresenta o mesmo baseline técnico e zero tabelas de negócio em `public`.

Portanto, as fases 008–017 permanecem não implementadas e não podem ser inferidas a partir da fase 006.

## Gate G1 — Foundation Ready

`G1 = APPROVED` em 23/08/2026.

### Evidências do gate

- arquitetura base formalizada e vigente;
- matriz de ambientes segregada e atualizada;
- CI/CD com build-once, artifact imutável, staging, rollback/restore e promoção protegida;
- Production Promotion run `32662438316`, attempt `3`, conclusion `success`;
- production `/health = 200` na revisão `517f44e788d0f74488ba54a09b44f18284d2b117`;
- production `/api/database-health = 200 / ready` na mesma revisão;
- Secrets Management concluído e governado;
- Banco Base concluído e reproduzível por migrations;
- staging dedicado validado com `/health = 200` e `/api/database-health = 200 / ready`;
- `B006-02 = RESOLVED`;
- nenhuma entidade de fase posterior foi antecipada.

G1 aprova a **fundação técnica**, não os controles de segurança de negócio das fases 008–017.

## Gate G2 — Security Ready

`G2 = NOT APPROVED`.

G2 continua dependente, no mínimo, de:

- Tenant/organização;
- usuários e memberships;
- autenticação;
- RBAC;
- enforcement de escopo organizacional;
- defesa adicional/RLS quando aplicável;
- testes cross-tenant;
- auditoria transversal.

## Próxima transição oficial

```text
006 = CONCLUDED
B006-02 = RESOLVED
G1 = APPROVED
007 = ACTIVE
```

A única etapa autorizada imediatamente após esta promoção é:

**007 — Convenções de Dados**.

Tenant (008) não deve ser ativado antes da conclusão e evidência da 007.