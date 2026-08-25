# 022 — Idempotência

## Estado

`ACTIVE / DEFINED`

A fase 022 é a única etapa funcional ativa após a conclusão formal da 021 — Error Handling. A fase 023 — Outbox e todas as posteriores permanecem `NOT ACTIVE`.

## Objetivo

Estabelecer um contrato transversal de idempotência para operações sensíveis do Moventra TMS, garantindo que a repetição da mesma intenção lógica, com a mesma `Idempotency-Key` e o mesmo conteúdo relevante, não duplique efeitos transacionais.

A base canônica da fase é:

```text
Idempotency-Key
+
Request Fingerprint
+
Stored Result
```

A infraestrutura deve ser reutilizável por pagamentos, contratação, aceite, webhooks, fiscal, importações e APIs externas quando esses domínios forem ativados, sem antecipá-los nesta fase.

## Decisão arquitetural

A recomendação oficial é persistir o registro de idempotência no PostgreSQL transacional e, sempre que o efeito de negócio também estiver no PostgreSQL, realizar:

```text
claim da chave
+
mutação de negócio
+
Audit de negócio
+
resultado idempotente
```

na **mesma transação PostgreSQL** e no mesmo contexto tenant/RLS.

Isso evita a janela clássica:

```text
negócio COMMIT
→ processo falha
→ resultado idempotente não foi salvo
→ retry duplica efeito
```

A fase 022 não promete exactly-once para efeitos externos que não participam da transação PostgreSQL. A garantia para publicação assíncrona confiável será ampliada pela fase 023 — Transactional Outbox.

## Escopo inicial

A fase materializa:

```text
idempotency.records
IdempotencyService
PostgresIdempotencyRepository
fingerprint canônico/versionado
integração com Error Handling 021
integração com Observabilidade 020
RLS tenant-aware
runtime least privilege
retention/expiry sem scheduler próprio
CI e validação PostgreSQL real
```

Não exige endpoint funcional de negócio novo apenas para demonstrar idempotência.

## Modelo de dados proposto

Schema:

```text
idempotency
```

Tabela principal:

```text
idempotency.records
```

Campos mínimos:

```text
id                  uuid PK
tenant_id           uuid NOT NULL
operation_key       varchar NOT NULL
key_hash            char(64) NOT NULL
key_hash_version    smallint NOT NULL
fingerprint         char(64) NOT NULL
fingerprint_version smallint NOT NULL
state               varchar NOT NULL
response_status     integer NULL
response_media_type varchar NULL
response_body       jsonb NULL
response_headers    jsonb NULL
created_at          timestamptz NOT NULL
completed_at        timestamptz NULL
expires_at          timestamptz NOT NULL
```

### Chave natural

A unicidade canônica deve ser:

```text
(tenant_id, operation_key, key_hash)
```

`operation_key` é identificador estável e controlado pela aplicação, por exemplo futuramente:

```text
payment.create
freight.contract
freight.accept
webhook.process
cte.issue
import.execute
```

Nunca usar URL arbitrária, mensagem livre, UUID de recurso ou valor fornecido pelo consumidor como label/namespace operacional sem normalização controlada.

## Idempotency-Key

A chave externa:

- é obrigatória somente para operações declaradas idempotentes/required;
- deve possuir limite de tamanho;
- deve ser tratada como dado potencialmente sensível;
- não deve ser persistida em texto puro por padrão;
- não deve ser registrada em logs, traces ou Audit;
- não deve ser usada como label de métrica.

Persistir:

```text
key_hash = SHA-256(normalized Idempotency-Key)
```

O hash evita exposição acidental da chave e mantém índice de tamanho previsível. `key_hash_version` permite evolução futura do algoritmo.

## Request Fingerprint

O fingerprint identifica a intenção lógica da requisição.

Deve ser calculado sobre representação canônica e versionada contendo apenas dados semanticamente relevantes, por exemplo:

```text
method lógico
operation_key
versão do contrato
scope organizacional relevante
payload canônico
```

Não incluir:

```text
Authorization
Cookie
tokens
requestId
correlationId
traceId
timestamp de transporte
headers não semânticos
ordem incidental de chaves JSON
```

Fingerprint:

```text
SHA-256(canonical representation)
```

`fingerprint_version` é obrigatório para evitar quebra silenciosa quando o algoritmo de canonicalização evoluir.

## State machine

Estados persistidos permitidos:

```text
PROCESSING
COMPLETED
```

No caminho transacional PostgreSQL padrão, `PROCESSING` existe apenas dentro da transação até o resultado ser concluído. Se a transação inteira falhar, o claim também é revertido.

Não criar nesta fase estados assíncronos duráveis como `QUEUED`, `PUBLISHED`, `DELIVERING` ou `DEAD_LETTER`; pertencem às fases 023–026.

## Algoritmo transacional

Fluxo canônico:

```text
BEGIN tenant transaction
  ↓
SET LOCAL moventra.tenant_id
  ↓
INSERT idempotency.records(state=PROCESSING)
ON CONFLICT tenant+operation+key_hash
  ↓
┌───────────────────────────────────────────────┐
│ chave nova                                    │
│   validar fingerprint                        │
│   executar mutação de negócio                │
│   produzir Audit de negócio                  │
│   armazenar resposta segura                  │
│   UPDATE record → COMPLETED                  │
│   COMMIT                                     │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│ chave existente                              │
│   aguardar resolução do conflito/lock        │
│   reler registro                             │
│   fingerprint diferente → 409                │
│   fingerprint igual + COMPLETED → replay     │
│   não executar mutação novamente             │
│   não duplicar Audit da mutação              │
│   COMMIT                                     │
└───────────────────────────────────────────────┘
```

A implementação pode usar `INSERT ... ON CONFLICT`, row lock e releitura, desde que o comportamento concorrente seja determinístico e comprovado em PostgreSQL real.

## Concorrência

Dois requests simultâneos com a mesma chave/fingerprint devem resultar em:

```text
1 execução efetiva
+
1 resultado persistido
+
N replays equivalentes
```

Nenhuma corrida pode produzir duas mutações.

A garantia deve ser baseada em constraint/transaction do PostgreSQL, não em mutex apenas em memória, cache local ou processo único.

## Replay

Quando a chave e o fingerprint coincidirem com registro `COMPLETED`, retornar o resultado persistido sem executar novamente a operação de negócio.

O boundary HTTP poderá sinalizar replay com header controlado:

```text
Idempotency-Replayed: true
```

Esse header é informativo e não altera o corpo original.

O resultado armazenado deve ser suficiente para reproduzir o contrato externo relevante:

```text
status HTTP
media type
body JSON seguro
subset allowlisted de response headers
```

Não persistir indiscriminadamente todos os headers.

## Reutilização de chave com payload diferente

Se a mesma chave, dentro do mesmo Tenant e `operation_key`, chegar com fingerprint diferente:

```text
HTTP 409
code = IDEMPOTENCY.REQUEST_MISMATCH
```

A resposta deve usar Problem Details da fase 021 e nunca revelar o fingerprint anterior, hash da chave, payload anterior ou identificadores de outro Tenant.

## Erros públicos da fase

Adicionar códigos controlados somente quando necessários ao contrato público:

```text
IDEMPOTENCY.KEY_REQUIRED
IDEMPOTENCY.REQUEST_MISMATCH
IDEMPOTENCY.RESULT_UNAVAILABLE
```

Regras sugeridas:

```text
KEY_REQUIRED       → 400
REQUEST_MISMATCH   → 409
RESULT_UNAVAILABLE → 500/503 conforme causa interna
```

Não criar códigos dinâmicos por `operation_key`.

## Segurança multi-tenant

O registro de idempotência é tenant-scoped.

Obrigatório:

```text
Auth
→ Membership
→ RBAC
→ Organizational Scope
→ Tenant transaction/RLS
→ Idempotency
→ operação
→ Audit
```

A chave enviada pelo cliente nunca determina Tenant. O `tenant_id` deve vir do contexto já autorizado.

RLS deve impedir leitura e escrita cross-tenant mesmo se um hash colidir ou for conhecido externamente.

## Integração com AuthorizedTenantOperationService

A implementação deve reutilizar a transação e o contexto autorizados existentes em `AuthorizedTenantOperationService`, atualmente baseados em `withTenantDatabaseTransaction` e `query` compartilhado.

A integração deve preservar:

- mesma conexão PostgreSQL;
- mesmo `tenant_id` transaction-local;
- autorização antes da mutação;
- resultado idempotente na mesma transação da mutação;
- Audit `SUCCESS` atômico apenas para a execução efetiva da mutação;
- replay sem duplicar o Audit da mutação original.

Se for necessário evoluir o contrato do `AuthorizedTenantOperationService` para distinguir execução efetiva de replay, a mudança deve ser backward-compatible e coberta por testes arquiteturais. Não duplicar o pipeline de Auth/RBAC/Scope/RLS em um segundo serviço concorrente.

## Audit

Idempotência não substitui Audit.

Regras:

- a primeira execução produz o Audit de negócio normal;
- replay não produz outro Audit como se uma nova mutação tivesse ocorrido;
- mismatch de chave pode gerar evento de segurança/operacional quando relevante, sem armazenar a chave em texto;
- ações administrativas futuras de limpeza/reprocessamento pertencem às fases operacionais posteriores e devem ser auditadas.

## Observabilidade

Integrar com a fase 020 usando dimensões controladas:

```text
idempotency.outcome = executed | replayed | mismatch | failed
operation_key       = allowlisted/controlado
```

Pode registrar em trace/log sanitizado:

```text
idempotency.outcome
idempotency.fingerprint_version
idempotency.key_hash_version
```

Não registrar:

```text
Idempotency-Key
key_hash
fingerprint
tenant UUID como metric label
payload bruto
stored response body em log
```

Métricas sugeridas de baixa cardinalidade:

```text
idempotency_requests_total{operation,outcome}
idempotency_duration_ms{operation,outcome}
```

## Retenção e expiração

Cada registro possui `expires_at`.

Nesta fase:

- definir TTL padrão de plataforma e possibilidade de configuração futura por operação;
- requests só podem reutilizar semanticamente registros ainda válidos;
- não implementar scheduler de purge, pois o framework central de Jobs é fase 025;
- não conceder `DELETE` à role principal de aplicação apenas para limpeza;
- documentar que cleanup físico futuro será realizado por principal operacional dedicado e auditado.

Expiração não pode permitir duplicação de uma operação cujo efeito de negócio seja juridicamente/permanentemente único sem regra específica do domínio. Domínios futuros podem exigir retenção maior que o TTL padrão.

## LGPD e minimização

Stored result deve conter apenas o necessário para replay do contrato.

Evitar persistir:

- tokens;
- cookies;
- credenciais;
- documentos brutos;
- dados pessoais que já possam ser referenciados por ID seguro;
- payload integral quando um resultado reduzido for suficiente.

`response_body` deve possuir limite de tamanho e sanitização explícita.

## Banco e constraints

Migration prevista:

```text
db/migrations/0014_idempotency.sql
```

Validation prevista:

```text
db/validation/0014_idempotency_validation.sql
```

Constraints mínimas:

```text
PK id
FK tenant_id → organization.tenants
UNIQUE (tenant_id, operation_key, key_hash)
CHECK state IN (PROCESSING, COMPLETED)
CHECK hash/version formats
CHECK response status range
CHECK completed_at coerente com state
CHECK expires_at > created_at
```

Índices mínimos:

```text
unique lookup tenant+operation+key_hash
expires_at para manutenção futura
```

Desnormalização adicional exige justificativa.

## Runtime least privilege

Atualizar o contrato versionado de privilégios PostgreSQL para o schema `idempotency`.

Role de runtime:

```text
USAGE schema
SELECT
INSERT
UPDATE somente o necessário
sem DELETE
sem DDL
sem BYPASSRLS
```

A validação deve provar que runtime:

- opera seus registros tenant-scoped;
- não acessa registros de outro Tenant;
- não executa DELETE;
- não altera migration metadata;
- não contorna RLS.

## APIs internas sugeridas

```text
src/modules/idempotency/idempotency-service.js
src/modules/idempotency/idempotency-repository.js
src/modules/idempotency/fingerprint.js
```

Contrato conceitual:

```text
IdempotencyService.execute({
  tenantId,
  operationKey,
  idempotencyKey,
  fingerprintInput,
  query,
  execute
})
```

Resultado interno:

```text
{
  outcome: executed | replayed,
  response,
  recordId
}
```

`recordId` é interno e não precisa ser exposto ao cliente.

## Compatibilidade

- mudança do algoritmo de fingerprint exige incremento de `fingerprint_version`;
- mudança do algoritmo de hash da chave exige `key_hash_version`;
- alteração da semântica de `operation_key` é breaking para o contrato de replay;
- stored result deve permanecer legível durante seu TTL;
- não depender de processo local ou instância Vercel específica.

## Testes obrigatórios

Unitários:

- canonicalização determinística;
- mesma intenção gera mesmo fingerprint;
- mudança semântica gera fingerprint diferente;
- ordem de chaves JSON não altera fingerprint;
- headers/IDs de correlação não alteram fingerprint;
- validação/limite da Idempotency-Key;
- chave não aparece em logs/erros.

Arquiteturais:

- 022 não implementa Outbox 023;
- nenhuma garantia de exactly-once externo é afirmada sem Outbox;
- serviço não confia em tenant vindo da chave/header;
- integração usa transação compartilhada e não duplica Auth/RBAC/Scope;
- replay não duplica Audit da mutação;
- observabilidade não usa chave/fingerprint como metric label.

PostgreSQL/integração:

- primeira execução cria efeito + record `COMPLETED`;
- replay sequencial retorna stored result sem novo efeito;
- duas execuções concorrentes produzem um único efeito;
- mesma chave + fingerprint diferente → 409/mismatch;
- rollback da operação remove claim e permite retry limpo;
- cross-tenant read/write bloqueados;
- runtime least privilege comprovado;
- constraint/index/TTL checks validados.

Runtime/CI:

- migrations aplicadas em banco limpo;
- re-run de migrations continua idempotente pelo framework;
- health/database-health preservados;
- Error Handling permanece sem regressão;
- build immutable artifact continua reproduzível;
- Staging, rollback/restore e Production seguem cadeia protegida.

## Casos de borda

- duas requisições chegam no mesmo milissegundo;
- cliente fecha conexão após COMMIT e repete request;
- processo falha antes do COMMIT;
- mesma key em Tenants diferentes;
- mesma key em `operation_key` diferente;
- JSON semanticamente igual com ordem diferente;
- body vazio;
- response body grande demais;
- stored response corrompido/incompatível;
- registro expirado;
- fingerprint version desconhecida;
- retry após serialization/deadlock;
- replay após alteração de deployment/revision;
- request com chave malformada ou excessivamente longa.

## Fora do escopo

- Transactional Outbox da 023;
- broker/mensageria da 024;
- scheduler/cleanup job da 025;
- DLQ da 026;
- exactly-once de provider externo;
- pagamentos, contratação, aceite, fiscal ou webhooks funcionais completos;
- UI administrativa de idempotency records;
- reprocessamento manual;
- cache distribuído como fonte de verdade.

## Critérios de conclusão

- migration `0014_idempotency.sql` aditiva e backward-compatible;
- validation correspondente;
- modelo tenant-scoped com RLS e constraints corretas;
- fingerprint e key hash versionados;
- `IdempotencyService` reutilizável;
- mesma transação para claim + efeito PostgreSQL + stored result;
- replay não duplica efeito nem Audit de mutação;
- mismatch retorna Problem Details seguro;
- concorrência real comprovada no PostgreSQL;
- rollback/retry comprovados;
- runtime least privilege atualizado e validado;
- observabilidade minimizada e sem alta cardinalidade;
- nenhuma antecipação de Outbox/Mensageria/Jobs;
- testes unitários/arquiteturais/integração verdes;
- CI completo verde;
- Neon Staging/Main validados quando migration for promovida;
- Staging validado;
- rollback/restore comprovado;
- Production somente após gate humano explícito e aprovação externa efetiva;
- Production evidence sem regressão;
- documentação, Issue e Confluence sincronizados.

## Próxima fase

A fase **023 — Transactional Outbox** permanece `NOT ACTIVE` até a conclusão formal da 022.