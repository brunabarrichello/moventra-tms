# P1 — Evidência final de Production e comportamento docs-only

## Estado

`CONCLUDED / PRODUCTION VERIFIED / DOCS-ONLY PROVEN`

Issue canônica: `#85`.

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

## Prova documentation-only

A própria evolução deste documento foi usada como prova operacional controlada. A PR #87 alterou somente documentação e foi incorporada à `main` em:

```text
documentation-only revision = 4d96525ef825eda49fdb7c2199d3e5cc4e96102c
Foundation CI               = 32843990500 = success
Moventra CI                 = 32843990586 = success
Release Gate                = 32844092522 = success
Rollback Drill              = 32844107836 = success
Production Promotion        = 32844120550 = success
```

O classificador observou:

```text
requires_release=false
classification=documentation-only
changed_file_count=1
runtime_file_count=0
documentation_file_count=1
```

Os jobs que alterariam runtime foram efetivamente pulados:

```text
Staging prebuilt deployment              = skipped
Provider-neutral prebuilt rollback drill = skipped
Production fail-closed preflight         = skipped
Protected production deployment          = skipped
```

### Prova no provedor de runtime

Consulta à Vercel após o timestamp do merge documental confirmou:

```text
Staging deployments novos    = 0
Production deployments novos = 0
```

O deployment Production funcional anterior permaneceu:

```text
id      = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
state   = READY
target  = production
aliases = moventra-tms.vercel.app, moventra-tms-alebru.vercel.app
```

Portanto, a revisão documental avançou `main` sem alterar o artefato executado em Staging ou Production e sem solicitar novo gate humano Production.

## Conclusão

A evidência final comprova simultaneamente:

- caminho runtime-impacting completo e protegido;
- artifact/revision identity;
- health e database readiness;
- ausência de runtime errors observados após promoção;
- aprovação externa efetiva sem self-review;
- classificação fail-closed de impacto;
- `documentation-only` sem deploy, rollback/restore ou Production gate.

`P1 = CONCLUDED`.
