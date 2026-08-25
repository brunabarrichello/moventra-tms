# 023 — Transactional Outbox

## Estado

`ACTIVE / DEFINED`

A fase 023 é a única etapa funcional ativa após a conclusão formal da 022 — Idempotência. A fase 024 — Mensageria e todas as posteriores permanecem `NOT ACTIVE`.

## Objetivo

Eliminar a janela entre o `COMMIT` da mutação de negócio e a intenção de publicação assíncrona, registrando um evento Outbox na mesma transação PostgreSQL do estado de negócio e do Audit correspondente.

Contrato canônico:

```text
mutação de negócio
+
Audit de negócio
+
outbox event
= mesma transação PostgreSQL
```

A fase 023 não publica em broker específico e não promete exactly-once fim a fim. Ela garante atomicidade local entre estado de negócio e registro do evento a publicar. A entrega futura deverá assumir at-least-once e consumidores idempotentes.

## Decisão arquitetural

O Outbox será provider-neutral e fará parte da infraestrutura transversal do monólito modular. Domínios produzem eventos de integração através de uma porta interna; não conhecem Kafka, RabbitMQ, SQS, SNS, EventBridge, Pub/Sub ou qualquer provider futuro.

A publicação externa não ocorre dentro da transação PostgreSQL. A transação apenas persiste o evento Outbox. A fase 024 — Mensageria definirá adapters/broker; a fase 025 — Jobs definirá o scheduler/dispatcher recorrente; a fase 026 — DLQ definirá tratamento de dead-letter.

## Modelo de dados proposto

Schema:

```text
outbox
```

Tabela principal:

```text
outbox.events
```

Campos mínimos:

```text
id                  uuid PK
tenant_id           uuid NOT NULL
aggregate_type      text NOT NULL
aggregate_id        uuid NULL
event_type          text NOT NULL
schema_version      smallint NOT NULL
payload             jsonb NOT NULL
metadata            jsonb NOT NULL
dedupe_key          text NULL
occurred_at         timestamptz NOT NULL
available_at        timestamptz NOT NULL
published_at        timestamptz NULL
attempt_count       integer NOT NULL
last_attempt_at     timestamptz NULL
claim_token         uuid NULL
claimed_at          timestamptz NULL
created_at          timestamptz NOT NULL
```

### Identidade do evento

`id` é UUID/UUIDv7 e representa a identidade imutável do evento de integração. Consumidores futuros podem usar esse ID para deduplicação.

### Tenant

`tenant_id` é obrigatório para eventos tenant-scoped e deve vir do contexto autorizado, nunca do payload do evento. Eventos realmente globais de plataforma deverão ser modelados por contrato separado quando houver caso real; não introduzir `tenant_id NULL` genericamente nesta fase.

### Aggregate

`aggregate_type` e `event_type` são identificadores controlados pela aplicação e estáveis, por exemplo futuramente:

```text
freight
trip
invoice
payment
shipment
```

```text
freight.created
trip.started
invoice.issued
payment.authorized
shipment.delivered
```

Não usar nomes derivados de URL, texto livre ou valores fornecidos pelo cliente.

### Payload e metadata

`payload` contém somente dados necessários ao contrato de integração. Preferir IDs e fatos de domínio a cópias integrais de entidades.

`metadata` é allowlisted e pode conter apenas informações técnicas estáveis necessárias ao tracing/integration contract, por exemplo:

```text
correlationId
causationId
actorType
schemaVersion
```

Nunca persistir:

```text
Authorization
Cookie
tokens
senhas
DSN
Idempotency-Key plaintext
payload bruto de requisição
headers arbitrários
```

## Estado operacional

A fase 023 evita uma state machine de broker. O evento Outbox possui apenas metadata operacional suficiente para claim/publicação futura:

```text
pending        = published_at IS NULL e claim expirado/ausente
claimed        = claim_token/claimed_at válidos
published      = published_at IS NOT NULL
```

Esses estados são derivados dos campos e não representam estado de negócio.

Não criar `DEAD_LETTER`, `RETRY_SCHEDULED`, `BROKER_ACKED` ou similares nesta fase.

## Atomicidade

Fluxo canônico:

```text
BEGIN tenant transaction
  ↓
SET LOCAL moventra.tenant_id
  ↓
autorizar Membership/RBAC/Scope
  ↓
Idempotência 022 (quando aplicável)
  ↓
mutação de negócio
  ↓
Audit SUCCESS
  ↓
INSERT outbox.events
  ↓
COMMIT
```

Se qualquer etapa falhar:

```text
ROLLBACK
→ mutação revertida
→ Audit SUCCESS revertido
→ outbox event revertido
→ claim de idempotência revertido quando fizer parte da mesma transação
```

Nenhum evento pode sobreviver a uma mutação que não foi commitada.

## Integração com Idempotência 022

Para uma operação idempotente:

- primeira execução efetiva cria no máximo um evento Outbox por fato lógico esperado;
- replay da mesma `Idempotency-Key` e fingerprint não executa novamente a mutação e não cria novo Outbox event;
- mismatch da chave não cria evento;
- rollback da execução remove também o evento.

O Outbox não substitui o registro idempotente. São responsabilidades complementares.

## Append API interna

API conceitual:

```text
OutboxService.append({
  tenantId,
  aggregateType,
  aggregateId,
  eventType,
  schemaVersion,
  payload,
  metadata,
  query
})
```

Regras:

- `query` deve pertencer à transação compartilhada do fluxo autorizado;
- `tenantId` deve corresponder ao tenant transaction-local;
- `aggregateType` e `eventType` devem ser allowlisted/normalizados;
- payload e metadata devem possuir limites de tamanho;
- o serviço não faz network I/O;
- o serviço não publica mensagem;
- o serviço não abre segunda transação concorrente.

## Claim API para preparação da fase 024/025

A fase 023 deve provar que múltiplos dispatchers futuros poderão competir sem selecionar o mesmo evento simultaneamente.

Contrato conceitual:

```text
claimBatch({
  limit,
  now,
  claimTtl,
  claimToken,
  query
})
```

Estratégia recomendada PostgreSQL:

```text
SELECT ... FOR UPDATE SKIP LOCKED
```

seguido de atualização do claim dentro da mesma transação de claim.

Essa API é infraestrutura de persistência; não cria scheduler, loop infinito, worker distribuído ou broker nesta fase.

## Concorrência

Obrigatório provar em PostgreSQL real:

```text
2 claimers concorrentes
→ lotes disjuntos
→ nenhum mesmo event id em ambos
```

Também provar:

```text
claim expirado
→ evento pode ser reclamado
```

`published_at` torna o evento inelegível para novos claims normais.

## Deduplicação

O ID do evento é a referência primária de deduplicação para consumidores futuros.

`dedupe_key` é opcional e só deve ser usado quando um domínio tiver uma chave lógica estável e comprovadamente necessária. Não criar unicidade global genérica que possa bloquear eventos legítimos diferentes.

## RLS e isolamento

`outbox.events` é tenant-scoped e deve ter RLS baseado em `security.current_tenant_id()`.

O runtime da aplicação:

```text
USAGE schema
SELECT
INSERT
UPDATE limitado ao necessário
sem DELETE
sem DDL
sem BYPASSRLS
```

A role principal de runtime não deve receber hard delete para cleanup. Retenção física futura pertence ao principal operacional dedicado do Jobs 025 e deverá ser auditada.

## Audit

Outbox não substitui Audit.

- Audit descreve quem fez o quê no sistema;
- Outbox descreve fato/evento a integrar com outros componentes;
- ambos podem nascer da mesma transação;
- replay idempotente não duplica Audit de negócio nem Outbox event;
- mudanças administrativas futuras em Outbox devem ser auditadas.

## Observabilidade

Dimensões permitidas de baixa cardinalidade:

```text
outbox.operation = append | claim | mark_published
outbox.outcome   = success | empty | conflict | failed
outbox.event_type = controlado/allowlisted
```

Não usar como metric labels:

```text
tenant_id
aggregate_id
event_id
claim_token
correlationId
payload values
```

Logs/traces podem carregar IDs somente quando estritamente necessários e sanitizados; payload não deve ser logado.

Métricas sugeridas:

```text
outbox_operations_total{operation,outcome}
outbox_operation_duration_ms{operation,outcome}
outbox_pending_events (gauge agregado, sem tenant label)
```

A métrica de backlog poderá ser refinada quando o dispatcher da fase 025 existir.

## Retenção

A fase 023 deve manter `published_at` e timestamps suficientes para futura política de retenção, mas não implementa purge scheduler.

Registros publicados não devem ser removidos pelo runtime principal. Retenção futura deve considerar auditoria, requisitos contratuais/fiscais, LGPD e troubleshooting.

## Erros

Reutilizar Error Handling 021. Códigos públicos só devem ser criados se houver boundary externo real. Como a fase 023 é inicialmente infraestrutura interna, não criar catálogo público excessivo.

Erros internos devem distinguir ao menos:

```text
invalid outbox contract
cross-tenant violation
payload/metadata size violation
invalid claim
concurrency/retryable database failure
```

Sem expor SQL, constraint interna, payload ou identificadores cross-tenant.

## Banco e migration

Migration prevista:

```text
db/migrations/0015_outbox.sql
```

Validation prevista:

```text
db/validation/0015_outbox_validation.sql
```

Constraints mínimas:

```text
PK id
FK tenant_id → organization.tenants
CHECK aggregate_type/event_type format
CHECK schema_version > 0
CHECK payload/metadata JSON object e size bounds
CHECK attempt_count >= 0
CHECK published/claim timestamps coerentes
CHECK claim_token e claimed_at ambos NULL ou ambos NOT NULL
```

Índices mínimos:

```text
pending eligibility por published_at/available_at/claimed_at
lookup tenant/event id
future retention por published_at/created_at
```

Evitar índice de payload JSON nesta fase sem query real que o justifique.

## Casos de borda

- transação de negócio falha após append → evento deve sumir com rollback;
- append falha → transação de negócio deve falhar, salvo contrato explicitamente diferente no futuro;
- replay idempotente → nenhum novo evento;
- dois claimers simultâneos → lotes disjuntos;
- claimer morre após claim → TTL permite reclaim futuro;
- evento marcado published → não volta a pending automaticamente;
- evento de Tenant A não pode ser lido/alterado sob Tenant B;
- payload acima do limite deve falhar antes/na persistência;
- event type desconhecido deve falhar antes da persistência;
- clock skew de app não deve definir verdade operacional; timestamps persistidos preferencialmente no PostgreSQL.

## Testes obrigatórios

Unitários:

- normalização/validação de aggregate/event type;
- payload/metadata bounds;
- append contract;
- integração idempotency replay → zero append adicional;
- observabilidade sem alta cardinalidade.

Arquiteturais:

- nenhum broker/provider importado no domínio;
- nenhuma implementação de Mensageria 024;
- nenhum scheduler/Jobs 025;
- nenhuma DLQ 026;
- append reutiliza transação compartilhada;
- runtime sem DELETE/DDL/BYPASSRLS.

PostgreSQL/integração:

- migration em banco limpo;
- rerun de migrations preserva histórico imutável;
- append + mutação + Audit + Outbox commitam atomicamente;
- rollback remove todos os efeitos;
- replay idempotente não duplica evento;
- cross-tenant RLS;
- claim concorrente com `SKIP LOCKED` produz lotes disjuntos;
- reclaim após expiração;
- published event não é reclamado;
- least privilege comprovado.

Runtime/CI:

- health/database-health preservados;
- build imutável reproduzível;
- Staging validado;
- rollback/restore comprovado;
- Production somente após gate humano explícito e aprovação externa efetiva;
- evidências de Production registradas.

## Critérios de aceite

- [ ] migration `0015_outbox.sql` aditiva e backward-compatible;
- [ ] validation correspondente;
- [ ] modelo tenant-scoped com RLS e constraints;
- [ ] runtime least privilege atualizado;
- [ ] `OutboxService` e repository reutilizáveis;
- [ ] append na mesma transação da mutação/Audit;
- [ ] integração com Idempotência 022 sem evento duplicado em replay;
- [ ] claim concorrente seguro comprovado em PostgreSQL real;
- [ ] rollback transacional comprovado;
- [ ] nenhuma antecipação de broker/Mensageria 024;
- [ ] nenhuma antecipação de scheduler/Jobs 025;
- [ ] nenhuma antecipação de DLQ 026;
- [ ] observabilidade de baixa cardinalidade;
- [ ] testes unitários/arquiteturais/integração verdes;
- [ ] CI completo verde;
- [ ] Neon Staging/Main validados;
- [ ] Staging validado;
- [ ] rollback/restore comprovado;
- [ ] Production protegida aprovada e evidenciada;
- [ ] documentação, Issue #103 e Confluence sincronizados.

## Fora do escopo

```text
024 — Mensageria / broker adapters
025 — Jobs / scheduler / dispatcher recorrente
026 — DLQ
Object Storage
workers distribuídos completos
exactly-once fim a fim
reprocessamento manual completo
UI administrativa de Outbox
integrações específicas de domínios ainda inativos
```

## Próxima etapa após conclusão

Somente depois da conclusão formal da 023 poderá ser ativada:

`024 — Mensageria`
