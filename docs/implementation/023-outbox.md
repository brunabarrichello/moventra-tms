# 023 — Transactional Outbox

## Estado

`CONCLUDED`

A fase 023 foi implementada, validada em PostgreSQL real, promovida pela cadeia oficial de Staging → rollback/restore → Production protegida e concluída com evidência de runtime, banco e governança. A fase **024 — Mensageria = ACTIVE / DEFINED**.

## Objetivo concluído

A fase eliminou a janela entre o `COMMIT` da mutação de negócio e a intenção de publicação assíncrona, registrando o evento Outbox na mesma transação PostgreSQL do estado de negócio e do Audit correspondente.

Contrato canônico materializado:

```text
mutação de negócio
+
Audit de negócio
+
outbox event
= mesma transação PostgreSQL
```

A garantia é de atomicidade local. A fase 023 não promete exactly-once fim a fim e não publica diretamente em broker. Entrega externa assume at-least-once e consumidores idempotentes.

## Implementação materializada

### Banco

```text
schema       = outbox
tabela       = outbox.events
migration    = db/migrations/0015_outbox.sql
validation   = db/validation/0015_outbox_validation.sql
```

Campos materializados:

```text
id                  UUID PK / uuidv7()
tenant_id           UUID NOT NULL
aggregate_type      TEXT NOT NULL
aggregate_id        UUID NULL
event_type          TEXT NOT NULL
schema_version      SMALLINT NOT NULL
payload             JSONB NOT NULL
metadata            JSONB NOT NULL
dedupe_key          TEXT NULL
occurred_at         TIMESTAMPTZ NOT NULL
available_at        TIMESTAMPTZ NOT NULL
published_at        TIMESTAMPTZ NULL
attempt_count       INTEGER NOT NULL
last_attempt_at     TIMESTAMPTZ NULL
claim_token         UUID NULL
claimed_at          TIMESTAMPTZ NULL
created_at          TIMESTAMPTZ NOT NULL
```

`tenant_id` é obrigatório, referencia `organization.tenants(id)` e é protegido por RLS usando `security.current_tenant_id()`.

### Código

```text
src/modules/outbox/outbox-contract.js
src/modules/outbox/outbox-repository.js
src/modules/outbox/outbox-service.js
src/modules/outbox/authorized-outbox.js
src/modules/outbox/outbox-observability.js
scripts/db/validate-outbox-concurrency.mjs
```

O módulo Outbox permanece provider-neutral: não importa RabbitMQ, Kafka, SQS, SNS, EventBridge, Pub/Sub ou SDK de broker.

## Regras consolidadas

- `tenantId` vem do contexto autorizado, nunca do payload do cliente;
- `aggregateType` e `eventType` são contratos controlados pela aplicação;
- payload é JSON minimizado, limitado e inspecionado contra campos sensíveis;
- metadata é allowlisted;
- nenhuma publicação de rede ocorre dentro da transação PostgreSQL;
- replay da Idempotência 022 não executa novamente a mutação e não cria segundo evento Outbox;
- rollback da transação remove mutação, Audit, claim idempotente e Outbox correspondente;
- evento publicado não volta automaticamente a pending;
- cleanup físico não é permitido ao runtime principal e permanece responsabilidade futura de Jobs 025;
- Audit e Outbox têm responsabilidades distintas e complementares.

## Estados operacionais derivados

```text
pending   = published_at IS NULL e claim ausente/expirado
claimed   = claim_token + claimed_at válidos
published = published_at IS NOT NULL
```

Não foi criada state machine de broker nem estado `DEAD_LETTER`, `BROKER_ACKED` ou `RETRY_SCHEDULED`.

## Concorrência

O claim usa PostgreSQL:

```text
FOR UPDATE SKIP LOCKED
```

seguido de atualização atômica de:

```text
claim_token
claimed_at
attempt_count
last_attempt_at
```

Foi comprovado em PostgreSQL real que:

```text
2 claimers concorrentes
→ lotes disjuntos
→ nenhum mesmo event id em ambos
```

Também foram comprovados reclaim após TTL e exclusão de eventos já publicados dos claims normais.

## Runtime least privilege

O runtime possui somente os privilégios necessários:

```text
USAGE no schema outbox
SELECT em outbox.events
INSERT em outbox.events
UPDATE somente em:
  attempt_count
  last_attempt_at
  claim_token
  claimed_at
  published_at
sem DELETE
sem CREATE no schema
sem BYPASSRLS
```

Payload, metadata, event type, tenant e demais fatos imutáveis não podem ser atualizados pelo principal de runtime.

## Integração com Idempotência 022

Fluxo consolidado quando a operação é idempotente:

```text
claim Idempotency-Key
→ autorização Tenant/RBAC/Scope/RLS
→ mutação de negócio
→ Audit SUCCESS
→ append Outbox
→ stored result
→ COMMIT
```

Replay do mesmo contrato retorna o stored result e não duplica:

```text
mutação
Audit SUCCESS
Outbox event
```

## Observabilidade

Métricas materializadas:

```text
outbox_operations_total{operation,outcome}
outbox_operation_duration_ms{operation,outcome}
```

Dimensões são controladas e de baixa cardinalidade. `tenantId`, `aggregateId`, `eventId`, `claimToken`, `correlationId` e valores de payload não são metric labels.

## Evidência oficial

```text
Issue                         = #103 = COMPLETED
PR técnica                    = #105
functional/runtime revision   = b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
Foundation CI (main)          = 32890000608
Moventra CI (main)            = 32890000544 = success
Release Gate / Staging        = 32890129781 = success
Rollback Drill                = 32890282262 = success
Production Promotion          = 32890504200 = success
Production deployment URL     = moventra-arotbh5h6-alebru.vercel.app
Stable Production alias       = moventra-tms.vercel.app
Production state              = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = dbe15e5b394811e62e645aed1502159f8d1d9cd512c3f4de90c8c070b88cb9c6
production evidence artifact  = production-deployment-b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
production evidence digest    = 09bfbdd7cdcccd75b615a2c33cc609f00761eda303741d23991fc5d108530e2e
migration                     = 0015_outbox.sql
```

O mesmo artefato imutável passou por Staging, rollback/restore e Production protegida. Revision identity e `/api/database-health` foram validados no deployment imutável e no alias estável.

## Governança de fechamento

```text
PR de governança = #107
merge            = d2e661cde2638d83b338920f49ac0e960da963e4
Confluence       = Moventra TMS — Projeto Oficial, versão 17
```

A revision identity funcional permanece `b585df5f...`; o merge documental posterior não reabre o gate funcional.

## Critérios de aceite finais

- [x] migration `0015_outbox.sql` aditiva e versionada;
- [x] validation correspondente;
- [x] modelo tenant-scoped com RLS e constraints;
- [x] runtime least privilege atualizado;
- [x] `OutboxService` e repository reutilizáveis;
- [x] append na mesma transação da mutação/Audit;
- [x] integração com Idempotência 022 sem evento duplicado em replay;
- [x] claim concorrente seguro comprovado em PostgreSQL real;
- [x] reclaim após expiração comprovado;
- [x] evento published não é reclamado novamente;
- [x] rollback transacional comprovado;
- [x] nenhuma antecipação de broker na fase 023;
- [x] nenhum scheduler/Jobs 025 antecipado;
- [x] nenhuma DLQ administrativa 026 antecipada;
- [x] observabilidade de baixa cardinalidade;
- [x] testes unitários/arquiteturais/integração verdes;
- [x] CI completo verde;
- [x] Neon Staging/Main validados;
- [x] Staging validado;
- [x] rollback/restore comprovado;
- [x] Production protegida aprovada e evidenciada;
- [x] documentação, Issue #103 e Confluence sincronizados.

## Próxima etapa

`024 — Mensageria = ACTIVE / DEFINED`

Documento: `docs/implementation/024-mensageria.md`  
Issue: `#106`

A fase **025 — Jobs** e todas as posteriores permanecem `NOT ACTIVE` até a conclusão formal da 024.
