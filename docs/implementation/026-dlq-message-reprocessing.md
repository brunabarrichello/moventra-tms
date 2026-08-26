# 026 — DLQ — Reprocessamento governado de mensagens

## Estado

`IMPLEMENTED ON BRANCH / NOT YET MERGED / NOT YET PRODUCTION EVIDENCED`

Unidade funcional da fase **026 — DLQ**. Não conclui a fase 026 e não ativa a 027.

Branch de implementação: `026-message-reprocessing`.

Baseline de origem: `5367494f0978ad6b72d8b1fbf539895b88ef837e`.

## Objetivo

Materializar o caso de uso provider-neutral de reprocessamento de entradas tenant-scoped `source_kind=message` sem permitir que operador, API ou broker forneçam novamente Tenant, payload, event type, exchange, queue ou routing key como fonte de autoridade.

O reprocessamento é uma nova tentativa controlada da mesma intenção lógica. A garantia permanece **at-least-once**; esta unidade não cria exactly-once fim a fim.

## Decisão arquitetural

O snapshot da DLQ é uma testemunha operacional minimizada e não é a fonte de reconstrução da mensagem.

A reconstrução usa o registro autoritativo `outbox.events`, lido pela role normal de runtime dentro do contexto tenant/RLS. O evento é então convertido pelo mapper canônico de mensageria e publicado pelo port `MessagingPublisher`.

Nenhum novo `SECURITY DEFINER`, grant cross-tenant, tabela ou migration é necessário para esta unidade.

## Fluxo

```text
DLQ entry tenant-scoped / quarantined
        │
        ├─ optimistic version check
        ▼
reprocess_pending
        │
        ├─ bounded claim token + lease
        ▼
reprocessing
        │
        ├─ SELECT Outbox source por source_id sob RLS
        ├─ validar id + tenant + eventType + schemaVersion
        ├─ validar witnesses imutáveis do snapshot, quando presentes
        ├─ mapOutboxEventToMessage(authoritativeSource)
        ├─ MessagingPublisher.publish(message)
        └─ publisher confirm
              │
              ├─ success → resolved / message_reprocessed
              └─ failure → quarantined + bounded backoff
                           ou exhausted no limite
```

## Fonte autoritativa

Para `source_kind=message`, `source_id` corresponde ao `outbox.events.id` original.

Antes de qualquer publicação, o caso de uso exige correspondência entre DLQ e Outbox:

```text
entry.source_id             == outbox.id
entry.tenant_id             == outbox.tenant_id
entry.source_type           == outbox.event_type
entry.source_schema_version == outbox.schema_version
```

Quando o snapshot contém `messageId`, `eventId`, `tenantId`, `eventType` ou `schemaVersion`, esses campos funcionam apenas como witnesses adicionais de integridade. O `snapshot.payload` nunca é republicado.

Isso também permite reprocessar com segurança uma entrada cujo snapshot tenha omitido payload grande, porque o payload válido continua vindo da fonte autoritativa de Outbox.

## Envelope e roteamento

A implementação reutiliza `mapOutboxEventToMessage()` e `MessagingPublisher` já estabelecidos na fase 024.

O mapper preserva:

```text
messageId = outbox.id
eventId   = outbox.id
tenantId  = outbox.tenant_id
eventType = outbox.event_type
schemaVersion
occurredAt
correlationId / causationId allowlisted
payload autoritativo
```

O adapter RabbitMQ vigente exige `routingKey === eventType` e usa publisher confirms. O reprocessador não recebe exchange, queue ou routing key do operador.

## Concorrência e state machine

O reprocessamento reutiliza os primitives já existentes em `PostgresDlqRepository`:

```text
requestReprocess(expectedVersion)
claimReprocess(claimToken, claimTtlMs)
completeReprocess(claimToken)
failReprocess(claimToken, failureCode, nextReprocessAt)
```

A solicitação exige `version` esperada e somente aceita `status=quarantined` dentro do limite de tentativas.

O SQL de `requestReprocess` passa a exigir também:

```text
next_reprocess_at IS NULL
OR next_reprocess_at <= clock_timestamp()
```

Assim, um novo comando manual não pode contornar o cooldown/backoff gravado após uma falha.

O claim incrementa `reprocess_count`, usa token/lease e permite recuperação de lease expirada conforme o contrato existente. A conclusão exige o mesmo claim token e lease ainda válida.

## Falhas e backoff

Após claim adquirido, falhas de source lookup, integridade, mapper, provider ou conclusão são convertidas em lifecycle DLQ por `failReprocess`.

O atraso usa `computeDlqReprocessDelay()` com exponencial bounded entre limites configurados. O código de falha persistido é estável e uppercase; erros sem código compatível convergem para `MVT_DLQ_REPROCESS_FAILED`.

Quando `reprocess_count >= max_reprocess_attempts`, o repository converge para `exhausted` e não agenda nova tentativa normal.

## Ambiguidade pós-publish

Pode ocorrer publisher confirm seguido de perda de lease/conflito antes de marcar a entrada como `resolved`.

Nesse cenário, o efeito externo pode ter ocorrido e a tentativa futura pode republicar a mesma intenção. Isso é compatível com a garantia **at-least-once** já adotada pelo Moventra.

A identidade lógica permanece estável (`messageId/eventId = outbox.id`), permitindo dedupe nos consumidores quando exigido pelo contrato.

Não gerar novo `messageId` para esconder uma tentativa duplicada.

## Segurança e tenancy

A role de runtime já possui `SELECT` em `outbox.events` e `dlq.entries`, ambos protegidos por RLS tenant-scoped. `dlq.system_entries` continua sem acesso para o runtime normal.

Esta unidade não adiciona:

```text
BYPASSRLS
acesso cross-tenant
novo SECURITY DEFINER
grant em dlq.system_entries
UPDATE em source/snapshot/metadata
input livre de payload/routing/handler
```

System DLQ continua fora desta superfície e exige capability/plano administrativo próprio no momento adequado.

## Contrato interno implementado

Arquivo principal:

```text
src/modules/dlq/message-reprocessor.js
```

Responsabilidades:

```text
DlqMessageReprocessor
  → valida entrada tenant/message
  → solicita transição com expectedVersion
  → adquire claim bounded
  → relê Outbox autoritativo
  → valida identidade imutável
  → usa mapper canônico
  → publica via MessagingPublisher
  → exige publisher confirm
  → resolve ou registra falha bounded
```

Leitura autoritativa adicionada a:

```text
PostgresOutboxRepository.findById({ id })
```

A RLS continua sendo aplicada pela sessão/contexto PostgreSQL da operação autorizada.

## API administrativa

Esta unidade não antecipa a superfície HTTP completa. Quando o endpoint `POST /api/v1/dlq/entries/{id}/reprocess` for materializado na unidade administrativa da própria fase 026, deverá obrigatoriamente envolver este caso de uso com:

```text
Auth
RBAC dlq.reprocess
Tenant/org scope
Idempotency-Key
If-Match / version
Audit Trail
correlation/request id
Problem Details
```

A API não poderá aceitar payload, tenant, handler, exchange, queue, event type ou routing key para alterar a intenção original.

## Testes desta unidade

Cobertura adicionada para:

```text
sucesso com payload somente do Outbox autoritativo
messageId/eventId estáveis
source_kind=job rejeitado antes de mutação
optimistic concurrency conflict
claim conflict sem efeito externo
Outbox source ausente
mismatch DLQ ↔ Outbox
publisher sem confirmação
provider error
conflito de conclusão após publisher confirm
bounded backoff
findById do Outbox
arquitetura provider-neutral
proibição de payload/routing/exchange/queue como input
cooldown enforceado no SQL
```

Os testes somente serão considerados evidência após execução verde no CI da branch/PR.

## Critérios de aceite do Batch

O Batch pode ser considerado implementado quando:

```text
unit/architecture/integration CI = SUCCESS
DLQ Contract                       = SUCCESS
Security CI                        = SUCCESS
PR revisada/mergeada               = YES
Staging release gate               = SUCCESS
Rollback Drill                     = SUCCESS
Production Promotion               = somente após novo gate humano explícito
Production smoke/evidence           = SUCCESS
```

Nenhum status de Production deve ser antecipado antes desses gates.

## Próxima unidade após evidência deste Batch

Após este reprocessamento de mensagens estar integrado e Production-evidenced, a próxima unidade da fase 026 é **reprocessamento governado de Jobs**.

A Issue #115 permanece aberta e `027 — Object Storage` permanece `NOT ACTIVE / BLOCKED` até a conclusão integral da 026.
