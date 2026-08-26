# 026 — DLQ — Reprocessamento governado de Jobs

## Estado

`IMPLEMENTED IN BRANCH / EXACT-HEAD CI REVALIDATION REQUIRED / STAGING, ROLLBACK AND PRODUCTION EVIDENCE PENDING`

Este documento descreve o delta de reprocessamento governado de Jobs da fase 026. Ele não conclui a fase e não ativa a 027.

### Nota de revalidação do CI

A primeira suíte de PR executou o delta funcional, mas o job geral de testes expôs fixtures unitários que não preservavam corretamente a identidade imutável da entrada DLQ ao simular transições de estado. Os fixtures foram corrigidos para derivar `reprocess_pending` e `reprocessing` do mesmo registro lógico. Como o GitHub não emitiu nova check suite para o commit corrigido após atualizações feitas pelo conector, a governança exige uma nova revisão com SHA inédito e CI completo antes de qualquer merge. Nenhuma evidência do head anterior será reutilizada para aprovar o head corrigido.

## Objetivo

Permitir que uma falha terminal capturada em `dlq.entries` ou `dlq.system_entries` seja reprocessada sem executar código arbitrário, sem aceitar payload/handler/schedule/tenant do operador e sem criar mais de um Job lógico para a mesma decisão DLQ.

## Fluxo

```text
DLQ quarantined
  → optimistic version check
  → reprocess_pending
  → lease/claim bounded
  → authoritative Job lookup by source_id
  → immutable source/snapshot witness validation
  → JobHandlerRegistry.resolve(source) only for contract validation
  → INSERT child Job from authoritative terminal row
  → relational lineage + unique DLQ replay guard
  → DLQ resolved(job_reprocessed)
```

O handler não é executado durante a ação administrativa. O novo Job entra no scheduler durável normal e será executado posteriormente pelo Job Worker, preservando lease, retry, backoff e semântica at-least-once existentes.

## Modelo de dados — migration 0020

A migration `0020_dlq_job_reprocessing_lineage.sql` adiciona em `jobs.jobs` e `jobs.system_jobs`:

- `reprocessed_from_job_id`;
- `reprocessed_from_dlq_entry_id`.

A lineage é opcional para Jobs normais e obrigatoriamente completa para Jobs reprocessados. O Job não pode referenciar a si mesmo.

Para tenant Jobs, as FKs são compostas com `tenant_id`, garantindo no PostgreSQL que Job origem e DLQ origem pertencem ao mesmo Tenant. O RLS continua ativo como defesa adicional, não como única barreira.

`reprocessed_from_dlq_entry_id` possui unicidade parcial. Assim, uma decisão DLQ pode gerar no máximo um Job filho lógico, inclusive se houver timeout/lease ambiguity depois do INSERT.

## Releitura autoritativa

`PostgresJobReprocessRepository.rescheduleFromTerminal()` usa `INSERT ... SELECT` a partir da própria linha `failed_terminal` em `jobs.jobs`/`jobs.system_jobs`.

Não recebe do operador:

- payload;
- metadata;
- job type;
- schema version;
- priority;
- max attempts;
- schedule key;
- recurrence;
- tenant.

Esses campos são copiados do Job autoritativo no banco. Um conflito de replay consulta a lineage pelo DLQ ID; se o filho já existe, o mesmo registro é retornado e a operação pode concluir de forma idempotente.

## Handler registry

Antes do reschedule, `JobHandlerRegistry.resolve(source)` valida:

- tipo de Job registrado;
- scope compatível;
- schema version suportada.

O handler retornado nunca é chamado inline. Isso impede que uma requisição administrativa se transforme em mecanismo de execução síncrona de código.

## State machine e falhas

O fluxo reutiliza a state machine DLQ já existente:

```text
quarantined
  → reprocess_pending
  → reprocessing
  → resolved

falha:
reprocessing
  → quarantined + bounded cooldown
  → exhausted após max_reprocess_attempts
```

`expectedVersion` protege a decisão inicial e a retomada de `reprocess_pending`. `claimToken` e TTL protegem concorrência entre workers/operadores. Falhas após reschedule são recuperáveis porque a lineage única retorna o mesmo filho na próxima tentativa.

## System scope

O domínio suporta `system` de forma fisicamente separada (`jobs.system_jobs` ↔ `dlq.system_entries`). Isso não concede acesso system-scoped ao runtime HTTP normal. As Admin APIs da próxima unidade serão explicitamente tenant-scoped; operações system-scoped exigem principal/capability operacional separado e não serão expostas por acidente.

## Testes

O delta inclui:

- unit tests do caso de uso;
- unit tests do repository;
- architecture tests do trust boundary;
- validation SQL da migration, incluindo:
  - lineage tenant/system;
  - unicidade por DLQ;
  - rejeição de lineage cross-tenant.

## Critério para promoção

Este Batch só passa a `PRODUCTION EVIDENCED` após:

```text
PR CI green no SHA exato
→ main CI green
→ Release Gate / Staging green
→ Rollback Drill green
→ Production Promotion com aprovação humana explícita
→ migration 0020 + checksum evidenciados
→ revision identity / DB readiness / messaging readiness verdes
```

Até esse ponto, a fase permanece `026 = ACTIVE / NOT CONCLUDED` e `027 = NOT ACTIVE / BLOCKED`.
