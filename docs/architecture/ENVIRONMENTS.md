# Ambientes — Moventra TMS

## Estado

`CONCLUDED / EVIDENCED`

## Objetivo

Padronizar a separação de ambientes de aplicação, banco, secrets e integrações do Moventra TMS sem exigir infraestrutura persistente quando um ambiente é deliberadamente local ou efêmero.

## Matriz oficial

| Ambiente | Finalidade | Banco Neon | Aplicação / deploy | Dados reais | Estado atual |
|---|---|---|---|---|---|
| Development | desenvolvimento diário | branch `development` | execução local ou efêmera; não requer projeto Vercel persistente | proibidos por padrão | segregado e aceito como modelo oficial |
| Test | testes automatizados | branch/banco efêmero ou PostgreSQL isolado | GitHub Actions / execução efêmera | proibidos | operacional e evidenciado no CI |
| Staging | homologação técnica, gates de release e futura UAT | branch `staging` | Vercel `moventra-tms-staging` (`prj_NYeCYXZur3CPG1sS1wC81ffKBkoU`) | mascarados/sintéticos por padrão | provisionado, Node 22.x, health e database readiness validados |
| Production | operação real | branch `main` | Vercel `moventra-tms` (`prj_5qFenjyeGE1joaGomaNrUIRGSBQs`) | permitidos sob controles LGPD | provisionado, Node 22.x, promotion protegida e database readiness validados |

> No Vercel, staging e production são projetos separados. Deployments do projeto de staging usam `target=production` dentro daquele projeto dedicado e isso não significa promoção para o projeto produtivo do Moventra.

## Decisão sobre Development

O modelo oficial não exige um terceiro projeto Vercel persistente para Development neste estágio da plataforma.

A segregação de Development é obtida por:

- branch Neon `development`;
- secrets/configuração não produtivos;
- execução local do código ou ambientes efêmeros controlados;
- proibição de uso de dados reais por padrão;
- nenhuma reutilização de credenciais de production.

Se futuramente houver necessidade de um ambiente compartilhado e persistente de desenvolvimento, ele poderá ser criado sem alterar a definição atual de staging/production.

## Regras obrigatórias

- credenciais devem ser segregadas por ambiente e menor privilégio;
- integrações externas devem usar sandbox quando disponível fora de produção;
- production não compartilha banco, principal PostgreSQL ou `DATABASE_URL` com ambientes inferiores;
- migrations são validadas em ambiente não produtivo/branch temporária antes da promoção à `main` do banco;
- logs evitam dados pessoais desnecessários e nunca contêm secrets;
- testes automatizados não dependem de production;
- artefatos promovidos entre staging e production preservam revisão e integridade;
- alterações de production passam pelos gates de `004 — CI/CD`;
- readiness de banco é obrigatório no release gate antes de encerrar a promoção.

## Evidência atual de staging

Projeto canônico:

```text
moventra-tms-staging
prj_NYeCYXZur3CPG1sS1wC81ffKBkoU
```

Encerramento operacional da Issue #44:

```text
deployment=dpl_GixB4SgQBQpuh6cXm6rcJ82EV5wa
state=READY
Node=22.x
/health=HTTP 200
/api/database-health=HTTP 200 / ready
rollback/restore=validated
```

O Project ID anterior de staging não é mais vigente e não deve ser reutilizado.

## Evidência atual de production

Revisão canônica:

```text
517f44e788d0f74488ba54a09b44f18284d2b117
```

GitHub Actions:

```text
Moventra Production Promotion
run=32662438316
attempt=3
conclusion=success
```

Vercel:

```text
project=moventra-tms
project_id=prj_5qFenjyeGE1joaGomaNrUIRGSBQs
deployment=dpl_BYNAb5FiqBeJkWeHATKZXCmfa7m4
state=READY
/health=HTTP 200 / version=517f44e788d0f74488ba54a09b44f18284d2b117
/api/database-health=HTTP 200 / status=ready / version=517f44e788d0f74488ba54a09b44f18284d2b117
```

## Estado do banco

Projeto Neon oficial:

```text
moventra-tms
shiny-mode-01639948
PostgreSQL 18.6
```

Branches permanentes:

- `main` — production/base;
- `staging` — staging;
- `development` — development.

`main` e `staging` possuem o baseline técnico 0001 validado, `moventra_meta.schema_migrations` e `moventra_meta.database_contract`, sem tabelas de negócio em `public`.

## Gate relacionado

Com arquitetura, ambientes, CI/CD, secrets e banco base evidenciados, a fundação técnica necessária ao G1 está satisfeita:

```text
001 = CONCLUDED
002 = CONCLUDED
003 = CONCLUDED
004 = CONCLUDED
005 = CONCLUDED
006 = CONCLUDED
G1  = APPROVED
007 = ACTIVE
```
