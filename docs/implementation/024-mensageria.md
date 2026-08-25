# 024 — Mensageria

## Estado

`ACTIVE / DEFINED`

A fase 024 é a próxima etapa oficial após a conclusão funcional e a promoção protegida da 023 — Transactional Outbox. A fase 025 — Jobs e todas as posteriores permanecem `NOT ACTIVE`.

## Objetivo

Introduzir uma camada transversal de mensageria para o Moventra TMS, desacoplada dos domínios e da persistência Outbox, capaz de publicar e consumir mensagens de forma confiável com semântica **at-least-once**, confirmação explícita, retry controlado no limite desta fase, observabilidade e contratos versionados.

A linha oficial define `RabbitMQ/serviço equivalente`. A decisão desta fase é:

```text
portas internas provider-neutral
+
primeiro adapter de referência RabbitMQ / AMQP 0-9-1
```

RabbitMQ é escolhido como implementação de referência por maturidade operacional, suporte a publisher confirms, ack/nack, prefetch, routing, TTL/dead-letter topology e ampla portabilidade entre provedores gerenciados e infraestrutura própria. O domínio não deve importar `amqplib`, AMQP ou qualquer SDK de broker.

## Princípios obrigatórios

- Outbox 023 continua sendo a fonte transacional da intenção de publicação;
- mensageria nunca ocorre dentro da transação PostgreSQL da mutação de negócio;
- publicação é at-least-once;
- consumers devem ser idempotentes;
- `messageId`/`eventId` devem ser estáveis e utilizáveis para deduplicação lógica;
- publisher confirms são obrigatórios;
- mensagens duráveis/persistentes são obrigatórias;
- ack/nack de consumo é manual;
- reconexão não pode causar busy-loop;
- broker credentials ficam exclusivamente em secret store;
- TLS é obrigatório fora de ambiente local/CI;
- payloads são minimizados e versionados;
- observabilidade não pode usar IDs de alta cardinalidade como labels;
- nenhuma regra de autorização deve confiar em headers arbitrários recebidos do broker.

## Boundary arquitetural

```text
Domínio / Application
        │
        ├── grava evento Outbox na transação 023
        │
        ▼
Transactional Outbox
        │
        │ claim/publish futuro
        ▼
MessagingPublisher Port
        │
        ▼
RabbitMQ Adapter
        │
        ▼
Broker
        │
        ▼
MessagingConsumer Port
        │
        ▼
Application Handler
```

A fase 024 implementa as portas e adapters. O **loop recorrente de despacho da Outbox pertence à 025 — Jobs** e não deve ser antecipado aqui.

## Envelope canônico

Toda mensagem Moventra deve usar envelope controlado pela aplicação:

```json
{
  "messageId": "uuid",
  "eventId": "uuid",
  "tenantId": "uuid",
  "eventType": "freight.created",
  "schemaVersion": 1,
  "occurredAt": "2026-08-25T19:39:00.000Z",
  "correlationId": "optional-safe-id",
  "causationId": "optional-safe-id",
  "payload": {}
}
```

Regras:

- `messageId` é a identidade de entrega e deve ser estável para uma publicação lógica;
- `eventId` referencia a identidade do evento Outbox;
- `tenantId` vem do evento Outbox/autorizado, nunca de input livre do consumer;
- `eventType` é namespaced e controlado pela aplicação;
- `schemaVersion` é inteiro positivo e permite evolução compatível;
- `occurredAt` é ISO-8601/UTC derivado do fato persistido;
- `correlationId` e `causationId` são opcionais, limitados e sanitizados;
- `payload` deve ser JSON object e obedecer limite de tamanho;
- secrets, cookies, tokens, DSNs, raw HTTP requests e headers arbitrários são proibidos.

## Routing

Topologia lógica inicial:

```text
exchange: moventra.events
kind: topic
routing key: <eventType>
```

O nome físico do exchange deve ser configurável por ambiente. Routing keys são derivadas apenas de `eventType` previamente validado.

Queues de consumidores devem ser declaradas pela aplicação/infraestrutura, não por payload do cliente. Nome de queue e binding são configuração confiável.

## Publisher

Porta conceitual:

```text
MessagingPublisher.publish({
  envelope,
  routingKey
}) -> {
  messageId,
  confirmed
}
```

Regras de implementação RabbitMQ:

- conexão AMQP persistente por processo quando o runtime permitir;
- `ConfirmChannel`;
- exchange durável;
- publicação com `persistent=true`;
- `messageId`, `correlationId`, `type`, `timestamp`, `contentType=application/json` em propriedades controladas;
- aguardar confirmação do broker antes de declarar sucesso;
- timeout de confirmação;
- falha/close do channel invalida a conexão local e exige reconexão controlada;
- não reexecutar automaticamente uma mutação de negócio; retry de publicação opera somente sobre o evento Outbox já commitado.

## Consumer

Porta conceitual:

```text
MessagingConsumer.subscribe({
  queue,
  handler,
  prefetch
})
```

Regras:

- `prefetch` limitado e configurável;
- `noAck=false`;
- validar envelope antes do handler;
- ack somente após handler concluir com sucesso;
- erro retryable pode resultar em nack/requeue conforme política controlada;
- erro não retryable pode ser reject/nack sem requeue para topology de dead-letter;
- consumer não deve transformar ausência de Tenant/RBAC em confiança automática;
- handlers de domínio continuam responsáveis por autorização/regra de negócio quando aplicável.

## Retry e backoff

A fase 024 define **classificação** e primitives de retry de mensageria, não o framework central de Jobs 025.

Categorias mínimas:

```text
connection_failure       -> retryable
channel_closed           -> retryable
publish_confirm_timeout  -> retryable
broker_nack              -> retryable, bounded
invalid_envelope         -> non-retryable
unsupported_schema       -> non-retryable
handler_domain_rejection -> non-retryable salvo regra explícita
handler_dependency_error -> retryable
```

Não criar `setInterval`, scheduler, cron ou worker infinito nesta fase.

## DLQ

A 024 deve ser compatível com dead-letter exchange/queue do RabbitMQ, permitindo que mensagens não requeueable sejam roteadas tecnicamente. Contudo:

- reprocessamento administrativo;
- UI/endpoint de reprocessamento;
- governança de operador;
- lifecycle completo da DLQ

pertencem à **026 — DLQ**.

A 024 não deve marcar a 026 como concluída nem implementar reprocessamento manual.

## Ordering

Não prometer ordering global. Quando um domínio exigir ordering, o requisito deverá ser explícito por stream/aggregate e tratado por topology/chave apropriada.

Nesta fase:

- preserve a ordem observável por um único channel publisher apenas como propriedade local;
- não assumir que múltiplos publishers/consumers preservam ordering global;
- documentar que consumidores devem suportar reentrega e possível reorder.

## Deduplicação

A entrega é at-least-once. `messageId` e `eventId` permitem deduplicação futura no consumer.

A 024 não cria uma tabela genérica de consumer inbox sem caso real. Quando consumidores internos críticos exigirem garantia persistente, introduzir Inbox/Dedup Store em fase própria ou como parte explícita do domínio correspondente.

## Configuração

Variáveis esperadas por ambiente:

```text
MESSAGING_PROVIDER=rabbitmq
MESSAGING_RABBITMQ_URL=<secret>
MESSAGING_EXCHANGE=moventra.events
MESSAGING_PREFETCH=20
MESSAGING_PUBLISH_CONFIRM_TIMEOUT_MS=5000
```

`MESSAGING_RABBITMQ_URL` é secret e nunca pode ser commitada, logada ou colocada em documentação com valor real.

Staging e Production devem usar brokers/virtual hosts/credentials segregados.

## Segurança

- TLS (`amqps://`) obrigatório em Staging/Production;
- usuário de runtime do broker com privilégio mínimo sobre vhost/exchange/queues necessários;
- sem management/admin credential no runtime;
- nomes de exchange/queue/routing vindos de configuração/catálogo confiável;
- payload e headers sujeitos a limites;
- logs não carregam body nem URL do broker;
- connection errors são sanitizados antes de chegar ao Error Handling 021;
- correlation IDs podem ser propagados apenas após validação de formato/tamanho;
- tenant IDs não são metric labels;
- consumers não deserializam formatos arbitrários além de JSON permitido.

## Observabilidade

Métricas de baixa cardinalidade:

```text
messaging_operations_total{operation,outcome}
messaging_operation_duration_ms{operation,outcome}
messaging_connections_total{outcome}
messaging_deliveries_total{outcome}
```

Dimensões controladas:

```text
operation = connect | publish | consume | ack | nack
outcome   = success | empty | retryable_error | rejected | timeout | failed
```

Não usar:

```text
tenantId
messageId
eventId
correlationId
routingKey arbitrária
queue arbitrária
payload values
```

Logs/traces podem conter IDs sanitizados quando necessários para troubleshooting, sem payload.

## Integração com Outbox 023

A porta de integração deve transformar um `outbox.events` claimado em envelope de mensageria sem alterar o fato original.

Fluxo conceitual futuro da 025:

```text
claim Outbox
  ↓
map Outbox -> MessageEnvelope
  ↓
publish + publisher confirm
  ↓
markPublished Outbox
```

A 024 deve fornecer o `mapper` e o `publisher`, mas **não o loop/scheduler**.

## Banco de dados

Por padrão, a fase 024 **não cria migration PostgreSQL**. A persistência de intenção continua em `outbox.events` e o broker é responsável pela fila externa.

Qualquer necessidade de persistência adicional só poderá ser introduzida se um requisito concreto de broker/consumer exigir e deverá ser justificada.

## Testes obrigatórios

Unitários:

- envelope válido/inválido;
- limites de payload/metadata;
- routing controlado;
- mapping Outbox -> envelope;
- error classification;
- publish confirm success/nack/timeout;
- ack/nack policy;
- redaction de broker URL/secrets;
- observabilidade sem alta cardinalidade.

Arquiteturais:

- domínios não importam RabbitMQ/`amqplib`;
- somente adapter de infraestrutura conhece AMQP;
- nenhuma implementação de Jobs 025;
- nenhuma implementação administrativa de DLQ 026;
- nenhuma migration `0016_messaging.sql` salvo decisão formal posterior;
- Outbox permanece provider-neutral.

Integração RabbitMQ real em CI:

- conexão TLS pode ser relaxada somente para broker local do CI;
- declaration de exchange/queue/binding;
- publish persistent + confirm;
- consume + manual ack;
- nack/requeue;
- dead-letter topology técnica;
- reconexão após channel/connection failure;
- mensagem duplicada mantém `messageId` estável quando a mesma publicação lógica é reexecutada;
- payload inválido é rejeitado antes do broker.

Release:

- CI completo verde;
- Staging deve possuir broker real segregado e smoke publish/consume;
- rollback/restore comprovado;
- Production somente após aprovação humana protegida;
- Production smoke deve confirmar conectividade/publicação controlada sem usar dados reais de negócio;
- evidência registrada sem expor credenciais.

## Critérios de aceite

- [ ] portas `MessagingPublisher` e `MessagingConsumer` provider-neutral;
- [ ] envelope canônico versionado;
- [ ] adapter RabbitMQ/AMQP 0-9-1;
- [ ] publisher confirms;
- [ ] mensagens persistentes;
- [ ] ack/nack manual;
- [ ] prefetch controlado;
- [ ] routing confiável;
- [ ] mapper Outbox -> envelope;
- [ ] retry classification segura;
- [ ] suporte técnico a dead-letter topology sem antecipar 026;
- [ ] observabilidade de baixa cardinalidade;
- [ ] secrets fora do código/log;
- [ ] testes unitários e arquiteturais verdes;
- [ ] integração RabbitMQ real no CI;
- [ ] Staging com broker real e credencial segregada;
- [ ] rollback/restore;
- [ ] Production protegida e evidenciada;
- [ ] Issue #106 e Confluence sincronizados.

## Fora do escopo

```text
025 — Jobs / scheduler / dispatcher recorrente
026 — DLQ / reprocessamento administrativo
worker fleet distribuída completa
exactly-once fim a fim
Inbox genérico sem caso real
Kafka/RabbitMQ dual-provider simultâneo
integrações específicas de domínios TMS ainda inativos
UI administrativa de filas
```

## Dependência externa de conclusão

A implementação local e o CI podem usar RabbitMQ efêmero para validação. Entretanto, a fase só pode chegar a `EVIDENCED / CONCLUDED` quando existir broker RabbitMQ/serviço equivalente real, segregado, acessível por Staging e Production, com TLS e credenciais de menor privilégio.

A ausência desse recurso é um bloqueio externo legítimo e não pode ser contornada por fallback inseguro, broker embutido ou credencial compartilhada.

## Próxima etapa após conclusão

Somente depois da conclusão formal da 024 poderá ser ativada:

`025 — Jobs`
