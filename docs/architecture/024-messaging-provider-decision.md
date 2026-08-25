# ADR — 024 Mensageria: porta provider-neutral e RabbitMQ como adapter de referência

## Estado

`ACCEPTED`

## Contexto

A fase 023 — Transactional Outbox registra atomicamente a intenção de publicação, porém não introduz broker. A fase 024 precisa materializar a fronteira de mensageria sem acoplar os domínios TMS ou o Outbox a um fornecedor específico.

A linha oficial do projeto estabelece `RabbitMQ/serviço equivalente` para Mensageria. O Moventra também precisa preservar portabilidade futura para brokers equivalentes e não antecipar Jobs 025 ou DLQ administrativa 026.

## Decisão

Adotar portas internas provider-neutral para publisher e consumer, com **RabbitMQ / AMQP 0-9-1 como primeiro adapter de referência**.

O adapter deve suportar publisher confirms, mensagens persistentes, manual ack/nack, prefetch controlado, routing confiável, reconexão sob demanda e topology técnica compatível com dead-letter. O domínio, os módulos de aplicação e o Outbox não podem importar `amqplib`, AMQP ou outro SDK de broker.

A entrega é `at-least-once`; exatamente uma entrega fim a fim não é prometida. Consumers devem tolerar reentrega e usar `messageId`/`eventId` estáveis para deduplicação quando necessário.

## Motivações

RabbitMQ possui semânticas maduras para confirmação de publicação, acknowledgements, controle de concorrência, routing e dead-lettering, além de ampla disponibilidade em serviços gerenciados. Ao manter o SDK restrito à infraestrutura, o Moventra pode substituir o provider no futuro sem reescrever os domínios.

Alternativas específicas de plataforma podem ser avaliadas futuramente, mas não devem redefinir a porta de aplicação. Recursos ainda marcados como beta/experimental não serão adotados como dependência canônica de produção nesta fase.

## Restrições operacionais

Staging e Production exigem broker/virtual host/credenciais segregados, TLS e menor privilégio. Credenciais permanecem em secret store e nunca são versionadas ou logadas. O CI pode usar RabbitMQ efêmero apenas para testes de contrato.

O smoke de CI deve ser **one-shot**, encerrar channels/conexões de forma graciosa e não criar processos recorrentes ou timers que antecipem Jobs 025.

## Consequências

A fase 024 pode implementar e testar o contrato de mensageria independentemente do scheduler. O loop recorrente Outbox → publish → markPublished permanece responsabilidade da 025 — Jobs. A gestão operacional de mensagens mortas e reprocessamento permanece responsabilidade da 026 — DLQ.
