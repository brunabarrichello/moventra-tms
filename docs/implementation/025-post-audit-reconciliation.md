# 025 — Jobs — Reconciliação Pós-Auditoria

## Estado

`EVIDENCED / CONCLUDED`

Este documento é um **delta de reconciliação** da baseline 025. Ele não substitui nem reescreve a evidência histórica da entrega original em `docs/implementation/025-jobs.md`.

A fase 025 foi originalmente concluída na revisão:

```text
d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
```

Após auditoria foi aberto o finding:

```text
MOV-P1-OBS-001 — Revision Identity do Worker Production
```

O finding foi corrigido pela PR #114 e validado em Production na revisão de hardening:

```text
3d0ac7864d784e9bd74046cd995fab5ca6321b15
```

A fase 025 permanece concluída. A revisão `d6fcf32e...` continua sendo a revisão histórica que concluiu a funcionalidade; `3d0ac786...` é a revisão pós-auditoria que corrige a identidade observável do runtime sem alterar o contrato funcional de Jobs/Outbox.

## Causa raiz

O Worker Railway Production já possuía `MOVENTRA_RELEASE_SHA`, porém `runtimeVersion()` não reconhecia essa variável. A resolução anterior era:

```text
APP_VERSION
→ VERCEL_GIT_COMMIT_SHA
→ development
```

Como Railway não fornece a identidade Vercel, o worker registrava:

```text
serviceVersion=development
```

mesmo executando uma revisão Git pinada.

## Correção

A precedência canônica passa a ser:

```text
MOVENTRA_RELEASE_SHA
→ APP_VERSION
→ VERCEL_GIT_COMMIT_SHA
→ development
```

Foram adicionados testes unitários de precedência e fallback. A PR #114 foi mergeada somente após os gates obrigatórios ficarem verdes.

## Evidência de CI

```text
PR                          = #114 = MERGED
hardening revision          = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
Foundation CI               = success
Moventra Jobs Contract      = success
Moventra CI                 = success
```

## Evidência de Production

Runtime:

```text
Railway project             = moventra-tms-production
Railway service             = moventra-worker-production
valid deployment            = 7c13314c-7f46-45b0-a9a7-6832ea039461
status                      = SUCCESS
source                      = brunabarrichello/moventra-tms / main
runtime                     = exec node src/worker.js
DB principal                = moventra_worker_app_production
handler                     = system.outbox_dispatch
release SHA                 = 3d0ac7864d784e9bd74046cd995fab5ca6321b15
```

O build comprovou fail-closed:

```text
PINNED_SHA='3d0ac7864d784e9bd74046cd995fab5ca6321b15'
git checkout "$PINNED_SHA"
test "$(git rev-parse HEAD)" = "$PINNED_SHA"
```

O startup do worker registrou:

```text
serviceVersion=3d0ac7864d784e9bd74046cd995fab5ca6321b15
environment=production
component=jobs-worker
databaseRole=moventra_worker_app_production
handlers=[system.outbox_dispatch]
```

Foram observados múltiplos ciclos de:

```text
system.outbox_dispatch claim   = success
outbox claim                   = empty quando sem pendências
system.outbox_dispatch execute = success
```

Filtros de runtime pós-deploy:

```text
error   = nenhum registro
failure = nenhum registro
```

Nenhum secret, DSN, token, credencial ou payload sensível foi observado nos logs amostrados.

## Achado de deploy Railway e decisão de hardening

O primeiro `redeploy` executado após a aprovação de Production gerou o deployment:

```text
ceb242a8-7eb6-48c3-b9f5-19b05eebf8c3
```

Ele terminou `SUCCESS`, porém reutilizou o snapshot/commit anterior:

```text
d6fcf32e56d812cc8df90fc9a4ef2191c18a4173
```

Consequentemente continuou emitindo `serviceVersion=development` e **não foi aceito como evidência do finding**.

Regra operacional consolidada:

> `redeploy` de um deployment Railway existente serve para reconstruir/reexecutar a revisão existente. Não deve ser usado como mecanismo de promoção de uma nova revisão Git.

Para uma nova revisão do Worker:

1. selecionar explicitamente o SHA aprovado por `commitSha`/deploy de revisão específica;
2. manter build pinado e fail-closed;
3. validar o SHA no build;
4. validar o mesmo SHA em `serviceVersion` no runtime;
5. executar smoke de Jobs/Outbox;
6. verificar ausência de erros/falhas e vazamento de secrets.

## Hardening 025 — estado reconciliado

| Item | Estado | Evidência |
|---|---|---|
| MOV-P1-OBS-001 — revision identity | **RESOLVED** | PR #114 + deployment `7c13314c...` |
| Worker dedicado | **VALIDATED** | `jobs.worker.started` em Production |
| Principal DB de menor privilégio | **VALIDATED** | `moventra_worker_app_production` |
| Outbox Dispatcher | **HEALTHY** | claim/execute success |
| Logs sem secrets observados | **PASS** | smoke/runtime pós-deploy |
| TLS PostgreSQL explícito `verify-full` | **OPEN / NON-BLOCKING** | hardening futuro antes de mudança major do driver |
| HA superior a 1 réplica | **OPEN / NON-BLOCKING** | evoluir conforme SLA/comercialização |
| Shutdown de observabilidade fail-soft | **OPEN / NON-BLOCKING** | manter exporter sem alterar correção de Jobs |

## Baseline oficial após reconciliação

```text
024 — Mensageria = EVIDENCED / CONCLUDED
025 — Jobs = EVIDENCED / CONCLUDED
MOV-P1-OBS-001 = RESOLVED / PRODUCTION VALIDATED
026 — DLQ = ACTIVE / DEFINED
027+ = NOT ACTIVE
```

Issue histórica 025: #110.

Issue ativa 026: #115.

## Regra de continuidade

A reconciliação não autoriza promoção automática da implementação 026 para Production. Desenvolvimento, CI, testes e Staging podem prosseguir conforme os gates normais. Qualquer deploy 026 em Production exige novo gate humano explícito.