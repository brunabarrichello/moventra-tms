# 006 — B006-02 — Runtime database readiness closeout

## Estado

`RESOLVED`

Data de encerramento canônico: `2026-08-23`.

## Objetivo do blocker

B006-02 exigia credenciais de runtime segregadas por ambiente, `DATABASE_URL` provisionada de forma secret-safe e evidência operacional de conectividade PostgreSQL em staging e production sem exposição de material sensível.

## Staging — PASS

O projeto Vercel anterior foi substituído. Projeto canônico atual:

```text
name=moventra-tms-staging
project_id=prj_NYeCYXZur3CPG1sS1wC81ffKBkoU
team=ALEBRU / team_3JTmWy5Z7vLfh2OqOwuFZp1G
```

Evidência validada no encerramento da Issue #44:

```text
deployment=dpl_GixB4SgQBQpuh6cXm6rcJ82EV5wa
state=READY
Node=22.x
/health=HTTP 200
/api/database-health=HTTP 200
status=ready
rollback/restore=validated
```

A `DATABASE_URL` foi sincronizada ao runtime por fluxo protegido sem publicação do valor.

## Production — PASS

Revisão promovida:

```text
517f44e788d0f74488ba54a09b44f18284d2b117
```

GitHub Actions:

```text
workflow=Moventra Production Promotion
run=32662438316
attempt=3
conclusion=success
```

O job protegido passou inclusive por:

- convergência do projeto Vercel;
- deploy do mesmo artefato imutável;
- revision identity;
- `Verify production database readiness`;
- registro e upload da production evidence.

Validação direta do alias canônico:

```text
https://moventra-tms.vercel.app/health
HTTP 200
status=ok
version=517f44e788d0f74488ba54a09b44f18284d2b117

https://moventra-tms.vercel.app/api/database-health
HTTP 200
status=ready
version=517f44e788d0f74488ba54a09b44f18284d2b117
```

Deployment validado após a promoção:

```text
dpl_BYNAb5FiqBeJkWeHATKZXCmfa7m4
state=READY
target=production
```

## Segurança

Nenhum valor de senha, token, `DATABASE_URL`, hash, prefixo ou connection string faz parte desta evidência.

A prova aceita é operacional:

```text
runtime revision correta
+
HTTP 200
+
status=ready
+
workflow protegido success
```

## Conclusão

```text
B006-02 = RESOLVED
006 = CONCLUDED
G1 = APPROVED
007 = ACTIVE
```

Este arquivo substitui o checkpoint anterior que ainda exigia fresh deployment de staging.