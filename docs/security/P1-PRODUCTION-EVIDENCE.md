# P1 — Evidência de Production e checkpoint de prova docs-only

## Estado

`PRODUCTION VERIFIED / DOCS-ONLY PROOF PENDING`

Issue canônica: `#85`.

Este documento registra a promoção funcional P1 antes da prova operacional final de que uma revisão exclusivamente documental não altera Staging/Production.

## Revisão funcional P1

```text
functional/runtime revision = 0a0ec943cc249e635d94267f386bb638228e11f7
PR                          = #86
Production Promotion run    = 32842852069
Release Gate run            = 32842647879
Rollback Drill run          = 32842739426
source CI run               = 32842532484
```

## Production protegida

O environment `production` foi efetivamente aprovado por revisor distinto do ator do workflow, com `prevent_self_review=true`.

```text
production_environment_id = 20383342298
required_reviewer_count   = 2
required_reviewers        = brunabarrichello,alexoaraujo83
workflow_source_actor     = brunabarrichello
approver                  = alexoaraujo83
approval_state            = approved
```

Nenhum bypass do gate protegido foi utilizado.

## Artefato imutável

```text
github_artifact_name   = moventra-tms-0a0ec943cc249e635d94267f386bb638228e11f7
artifact_sha256        = 68cf7e0615474febdd86d307267de358c60b39565edcb36a6d46bab07a97a5cf
Production deployment = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
Production URL        = https://moventra-jfif0uhzu-alebru.vercel.app
stable aliases        = moventra-tms.vercel.app, moventra-tms-alebru.vercel.app
state                 = READY
target                = production
region                = iad1
Node policy           = 22.x
```

## Runtime/readiness

O workflow protegido comprovou a revisão exata tanto no deployment imutável quanto no alias estável.

```text
/health deployment      = success @ 0a0ec943cc249e635d94267f386bb638228e11f7
/health stable          = success @ 0a0ec943cc249e635d94267f386bb638228e11f7
/database-health deploy = success @ 0a0ec943cc249e635d94267f386bb638228e11f7
/database-health stable = success @ 0a0ec943cc249e635d94267f386bb638228e11f7
runtime errors          = none observed after promotion
```

Fetch autenticado posterior de `/health` retornou HTTP 200 com `version=0a0ec943cc249e635d94267f386bb638228e11f7`.

## Staging e rollback/restore

A revisão P1 foi classificada `runtime-impacting` pelo Release Gate e percorreu integralmente:

```text
Moventra CI
→ immutable artifact
→ Release Gate / Staging
→ exact revision identity
→ database readiness
→ Rollback Drill
→ rollback smoke
→ restore exact current artifact
→ restored smoke
→ protected Production approval
→ Production
```

Todos os jobs acima concluíram com `success`.

## Próximo critério antes do encerramento P1

O único critério operacional ainda pendente neste checkpoint é provar com uma revisão real **documentation-only** que:

```text
Release Gate impact = documentation-only
Staging deployment = skipped
Rollback Drill deploy/restore = skipped
Production preflight/deployment = skipped
Vercel Staging/Production = sem novo deployment causado pelo commit documental
```

A fase 018 permanece `NOT ACTIVE` até essa prova e a sincronização final da Issue #85 e do Confluence.
