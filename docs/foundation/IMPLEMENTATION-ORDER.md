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
| 003 — Ambientes | **CONCLUDED** | Development/Test/Staging/Production segregados conforme a arquitetura vigente |
| 004 — CI/CD | **CONCLUDED** | build-once, artefato imutável, staging, rollback/restore, production protegida, revision identity e evidence validados; promotion run `32662438316` attempt 3 = success |
| 005 — Secrets Management | **CONCLUDED** | stores segregados, credenciais por ambiente, least privilege e governança de secrets validados |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6, baseline técnico 0001, migration framework, runtime least privilege e readiness validados; `B006-02 = RESOLVED` |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico em `docs/data/DATA-CONVENTIONS.md`, guardrails em `tests/architecture/data-conventions.test.js`, PR #51 mergeada e CI verde |
| 008 — Tenant | **ACTIVE / DEFINED** | primeira etapa estrutural autorizada após a 007; nenhuma entidade criada ainda |
| 009 — Empresa | **NOT ACTIVE / DEFINED** | nenhuma entidade criada; depende da conclusão de Tenant |
| 010 — Filial | **NOT ACTIVE / DEFINED** | nenhuma entidade criada; depende de Empresa |
| 011 — Usuários | **NOT ACTIVE / DEFINED** | identidade de negócio ainda não implementada no banco |
| 012 — Memberships | **NOT ACTIVE / DEFINED** | vínculo usuário ↔ tenant/empresa/filial ainda não implementado |
| 013 — Auth | **NOT ACTIVE / DEFINED** | provider não deve contaminar a identidade de negócio; implementação posterior |
| 014 — RBAC | **NOT ACTIVE / DEFINED** | autorização backend e modelo físico ainda não implementados |
| 015 — Escopo Organizacional | **NOT ACTIVE / DEFINED** | enforcement tenant/company/branch será posterior a RBAC/memberships |
| 016 — RLS / Defesa adicional | **NOT ACTIVE / DEFINED** | ADR-0002 vigente; RLS somente após contrato de contexto e testes cross-tenant |
| 017 — Auditoria Central | **NOT ACTIVE / DEFINED** | trilha transversal ainda não implementada |

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

A ativação da 008 **não** significa implementação de Tenant. Até a primeira migration da fase 008 ser criada, o banco continua deliberadamente sem tabelas de negócio.

## Gate G1 — Foundation Ready

`G1 = APPROVED` em 23/08/2026.

### Evidências do gate

- arquitetura base formalizada e vigente;
- matriz de ambientes segregada;
- CI/CD com build-once, artifact imutável, staging, rollback/restore e promoção protegida;
- Production Promotion run `32662438316`, attempt `3`, conclusion `success`;
- production `/health = 200` e `/api/database-health = 200 / ready` na revisão canônica da fundação;
- Secrets Management concluído e governado;
- Banco Base concluído e reproduzível por migrations;
- staging dedicado validado;
- `B006-02 = RESOLVED`.

G1 aprova a **fundação técnica**, não os controles de segurança de negócio das fases 008–017.

## 007 — evidência de conclusão

A fase 007 consolidou as convenções em contrato normativo e adicionou checks automatizados sem criar entidade de negócio.

```text
PR #51
merge commit = 46e08ce5cefe2c5d3df9eb89bcaee096dc9f9fa5
Foundation CI run = 32672159870 / success
Moventra CI run = 32672159907 / success
```

O contrato fixa UUIDv7, temporalidade, money/decimal, naming SQL, escopo tenant-aware, histórico/LGPD, concorrência, estados e regras de migration para as fases seguintes.

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
G1 = APPROVED
007 = CONCLUDED
008 = ACTIVE
009 = NOT ACTIVE
G2 = NOT APPROVED
```

A única etapa estrutural autorizada agora é:

**008 — Tenant**.

Empresa (009) e todas as etapas seguintes permanecem não ativas até a conclusão e evidência da 008.