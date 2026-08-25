# 020 — Observabilidade Base

## Estado

`ACTIVE / DEFINED`

A fase 020 é a única etapa funcional ativa após a conclusão formal da 019 — Feature Flags. A fase 021 — Error Handling e todas as posteriores permanecem `NOT ACTIVE`.

## Objetivo

Estabelecer a plataforma transversal de observabilidade do Moventra TMS para aplicação, APIs, banco e domínios, com **OpenTelemetry vendor-neutral**, logs estruturados, traces distribuídos, métricas, correlation/request IDs, contexto seguro e diagnósticos operacionais utilizáveis em Staging e Production.

Observabilidade deve permitir responder, com evidência:

```text
qual revisão está executando?
qual request falhou?
qual rota/serviço ficou lento?
qual dependência degradou?
qual trace atravessou o fluxo?
qual métrica mudou?
qual Tenant/contexto estava envolvido sem vazar PII?
```

A fase não substitui Audit. Audit registra fatos de negócio/segurança com retenção e imutabilidade próprias; telemetria mede comportamento operacional e possui retenção/cardinalidade diferentes.

## Decisão arquitetural

A base será **OpenTelemetry (OTel)** e protocolo **OTLP**, sem SDK proprietário de fornecedor como dependência arquitetural central.

Camadas:

```text
HTTP/runtime
→ request context
→ structured logging
→ traces
→ metrics
→ exporters OTLP opcionais
```

O código de domínio deve depender de abstrações internas pequenas (`observability.*`) e da API OTel quando necessário, não de detalhes de um backend específico.

Exportação de telemetria é **fail-safe/fail-open para disponibilidade da aplicação**: indisponibilidade do collector/backend de observabilidade não pode derrubar requests de negócio. Falhas de exportação devem ser diagnosticáveis localmente sem criar loop infinito de logs.

## Escopo funcional

### 1. Contexto de request

Cada request recebe/propaga:

```text
requestId
correlationId
traceId
spanId
```

`requestId` é único por request. `correlationId` pode agrupar uma cadeia lógica de requests e deve ser validado antes de aceitar valor externo.

Headers:

```text
traceparent / tracestate = W3C Trace Context
x-correlation-id         = correlação de aplicação
x-request-id             = identificação do request
```

Valores inválidos, excessivamente longos ou fora do formato aceito são descartados e regenerados.

O contexto interno usa `AsyncLocalStorage`, evitando parâmetros transversais espalhados por todas as assinaturas.

### 2. Logs estruturados

Formato JSON, uma linha por evento, com campos canônicos:

```text
timestamp
level
service
serviceVersion
environment
message
event
requestId
correlationId
traceId
spanId
route
method
statusCode
durationMs
outcome
error.type
error.code
```

Campos tenant/user são opcionais e somente podem ser adicionados após contexto confiável/autorizado. Nunca registrar:

```text
Authorization/Cookie headers
tokens
passwords
connection strings
DATABASE_URL
secrets
payload completo por padrão
email/telefone/documento pessoal desnecessário
SQL com valores sensíveis
```

Redação e normalização são centralizadas. Objetos arbitrários não são serializados recursivamente sem allowlist/limites.

### 3. Traces

Spans mínimos:

```text
HTTP server request
health/database-health quando instrumentados
operações de autorização relevantes
operações de domínio explicitamente instrumentadas
PostgreSQL em nível seguro
Feature Flag evaluation/write hooks
```

Propagação segue W3C Trace Context. Não usar `tenant_id`, `user_id`, e-mail ou IDs de negócio como nome de span.

Nomes de span e atributos devem ter cardinalidade controlada:

```text
HTTP GET /api/v1/trips/:id       = permitido
HTTP GET /api/v1/trips/uuid-real = proibido como nome de span
```

Captura de statement SQL com valores é desabilitada por padrão.

### 4. Métricas

Métricas base:

```text
http_server_requests_total
http_server_request_duration_ms
http_server_errors_total
observability_export_errors_total
```

Atributos permitidos de baixa cardinalidade:

```text
service
method
route template
status class
outcome
environment
```

Não usar como label de métrica:

```text
tenantId
userId
requestId
traceId
UUIDs de entidades
URL bruta com parâmetros
mensagem de erro arbitrária
```

Hooks de métricas já definidos por Feature Flags podem ser ligados à base:

```text
feature_flag_evaluation_total{flag,source,outcome}
feature_flag_evaluation_error_total{flag,reason}
feature_flag_rule_write_total{target,outcome}
feature_flag_rollout_bucket_total{flag,enabled}
```

`flag` somente é aceitável por ser catálogo controlado; ainda assim deve existir limite operacional para impedir explosão de cardinalidade futura.

### 5. Resource attributes

Resource OTel mínimo:

```text
service.name = moventra-tms
service.version = revision identity
service.namespace = moventra
deployment.environment.name = development|preview|staging|production
```

A revisão vem de fonte confiável de build/runtime (`VERCEL_GIT_COMMIT_SHA`/contrato equivalente já usado pela aplicação), nunca de input do cliente.

### 6. Exporters e configuração

Exportação OTLP é configurada exclusivamente por ambiente/runtime:

```text
OTEL_SDK_DISABLED
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS
OTEL_TRACES_EXPORTER
OTEL_METRICS_EXPORTER
OTEL_TRACES_SAMPLER
OTEL_TRACES_SAMPLER_ARG
```

Headers de exporter são secret e nunca aparecem em logs, health ou respostas HTTP.

A ausência de endpoint/exporter em ambiente local deve permitir execução com providers no-op/console somente quando explicitamente apropriado. Production não deve imprimir spans/metrics volumosos em stdout como substituto de collector.

## Sampling

Sampling é configurável por ambiente e usa política parent-based para preservar decisões upstream.

Regras:

- errors não podem depender exclusivamente de sampling para serem observáveis; logs de erro permanecem estruturados;
- health checks podem ser excluídos ou amostrados agressivamente para reduzir ruído;
- sampling nunca altera comportamento de negócio;
- mudança de taxa não exige mudança de domínio;
- nenhum cliente controla taxa de sampling via header arbitrário.

## Health, readiness e observabilidade

Contratos existentes são preservados:

```text
/health                 = liveness da aplicação
/api/database-health    = readiness da dependência PostgreSQL
```

Observabilidade não transforma `/health` em chamada a exporter/collector. O backend de telemetria não é requisito de liveness.

A aplicação deve incluir revision identity nos contratos já existentes, sem expor secrets ou detalhes internos desnecessários.

## HTTP instrumentation

O request boundary deve:

1. validar/gerar requestId e correlationId;
2. extrair contexto W3C;
3. abrir contexto AsyncLocalStorage;
4. iniciar/continuar span HTTP;
5. executar handler;
6. registrar status/duração;
7. finalizar span e métricas em `finally`;
8. devolver `x-request-id` e `x-correlation-id` quando seguro.

Headers e URL raw não são logados integralmente.

## PostgreSQL instrumentation

Instrumentação do `pg` deve:

- criar spans client/dependency sem registrar senha/DSN;
- não anexar connection string completa;
- evitar statement SQL com valores por padrão;
- preservar pool e transações vigentes;
- não modificar isolamento, RLS ou semantics de query;
- não registrar `moventra.tenant_id` como label de alta cardinalidade em métricas globais.

## Integração com segurança e Audit

Observabilidade deve respeitar:

```text
LGPD
least privilege
minimização de dados
segregação entre Tenants
redaction
retenção adequada
```

Audit e telemetria não são duplicados indiscriminadamente.

Exemplo:

```text
Audit: role.assignment.created, actor, resource, outcome
Trace/log: operação de autorização durou X ms e retornou outcome SUCCESS/DENIED
```

Eventos `DENIED` e `FAILED` podem gerar logs/metrics de segurança com campos minimizados, mas não tokens/assertions brutas.

## Error boundary e fase 021

A fase 020 instrumenta erros existentes, mas **não cria o catálogo/contrato completo de Error Handling da fase 021**.

Permitido agora:

```text
normalizar Error para telemetria
capturar type/code seguro
marcar span como error
incrementar métricas
log estruturado sanitizado
```

Fora da fase 020:

```text
novo envelope HTTP universal de erro
catálogo empresarial completo de códigos
problem+json global
retry classification transversal
mapeamento completo domain→HTTP
```

## API e exposição

Não será criada API pública para consultar traces, logs ou métricas nesta fase.

Dashboards/backends observacionais são infraestrutura operacional e não recursos tenant-facing do TMS.

Qualquer endpoint futuro de diagnóstico administrativo deverá exigir autorização própria e nunca permitir consulta cross-tenant arbitrária.

## Segurança de cardinalidade e custo

Toda nova instrumentação deve passar por revisão de cardinalidade.

Princípio:

```text
métrica = dimensão limitada/controlada
trace/log = contexto rico, porém minimizado e com retenção adequada
Audit = fato de negócio/segurança durável
```

Limitar tamanho de:

```text
message
error stack
correlationId
custom attributes
serialized metadata
```

Stack traces são permitidas em logs internos de erro, desde que sanitizadas e sem secrets conhecidos. Não retorná-las ao cliente.

## Retenção e LGPD

A fase 020 define política lógica, independente de fornecedor:

- logs operacionais: retenção curta/média conforme ambiente e necessidade operacional;
- traces: retenção menor que Audit e com sampling;
- métricas agregadas: retenção maior quando custo permitir;
- Audit: segue política própria, fora desta fase;
- dados pessoais em telemetria devem ser minimizados e, quando inevitáveis, classificados e sujeitos a política de retenção/apagamento compatível com LGPD.

A configuração física de retenção no backend escolhido deve ser documentada por ambiente quando o collector/backend for conectado.

## SLO/SLI base

A fase cria fundação para SLIs, sem antecipar gestão completa de SRE.

SLIs mínimos derivados:

```text
availability = proporção de requests não 5xx
latency      = distribuição de duração por route template
error rate   = proporção/contagem de 5xx e falhas de dependência
DB readiness = sucesso/latência do database-health
```

Não definir SLO contratual externo sem dados históricos e decisão de produto/operação.

## Observability facade interna

Abstrações recomendadas:

```text
src/infrastructure/observability/telemetry.js
src/infrastructure/observability/request-context.js
src/infrastructure/observability/logger.js
src/infrastructure/observability/metrics.js
src/infrastructure/observability/tracing.js
```

API interna mínima:

```text
initializeObservability()
shutdownObservability()
runWithRequestContext(context, callback)
getRequestContext()
createLogger(component)
recordHttpRequest(...)
getTracer(component)
getMeter(component)
```

Inicialização deve ser idempotente no mesmo processo e segura para ambientes serverless.

## Testes obrigatórios

Unitários:

- geração/validação de requestId/correlationId;
- AsyncLocalStorage sem vazamento entre requests concorrentes;
- logger redige headers/secrets;
- logger associa trace/span IDs ativos;
- métricas usam labels de baixa cardinalidade;
- health routes não dependem de exporter;
- initialization/shutdown idempotentes;
- falha de exporter não quebra handler;
- revision/environment resource attributes corretos;
- feature flag hooks usam a facade sem alterar decisão.

Arquiteturais:

- dependência OpenTelemetry vendor-neutral;
- proibição de SDK proprietário obrigatório;
- nenhum token/DSN hardcoded;
- nenhuma métrica usa tenant/user/request/entity UUID como label;
- observabilidade não substitui Audit;
- fase 021 não é antecipada;
- CI exige artefatos da fase 020.

Runtime:

- Staging produz health/database-health 200 após instrumentação;
- logs contêm request/correlation IDs sem PII;
- revision identity preservada;
- ausência de exporter não derruba aplicação;
- quando exporter estiver configurado, spans/metrics são emitidos sem bloquear requests;
- rollback/restore continua válido.

## Dependências

Preferir pacotes oficiais OpenTelemetry compatíveis com Node 22. Versões devem ficar lockadas no `package-lock.json`.

A composição deve ser mínima: API/SDK, instrumentação HTTP/PG quando necessária e exporters OTLP somente se o ambiente estiver configurado para uso real.

Não adicionar vendor agent proprietário como requisito de execução.

## CI/CD

Atualizar `.github/workflows/ci.yml` para exigir os artefatos da fase 020 e importar/inicializar o módulo observacional no job de runtime dependencies.

A release continua usando:

```text
build once
→ immutable artifact
→ Staging
→ rollback/restore
→ protected Production approval
→ same artifact
```

Mudança de observabilidade é runtime-impacting e exige o gate humano de Production.

## Banco de dados

A fase 020 **não requer nova migration de banco por padrão**.

Não criar tabelas de logs, traces ou métricas no PostgreSQL transacional do TMS. Telemetria de alto volume pertence a backend observacional apropriado.

Se durante a implementação surgir requisito real de persistência relacional, ele deve ser explicitamente justificado antes de introduzir `0014_*`; não é autorizado implicitamente por esta especificação.

## Casos de borda

- request sem traceparent → novo trace válido;
- traceparent inválido → ignorar e gerar contexto novo;
- correlation ID enorme/inválido → regenerar;
- requisições concorrentes → contextos isolados;
- exporter lento/indisponível → request não fica dependente dele;
- flush/shutdown em serverless → bounded timeout;
- erro serializando metadata → logger produz fallback seguro;
- payload circular → não quebrar request;
- health storms → evitar cardinalidade/trace volume desnecessário;
- route desconhecida → usar label `unknown`/template controlado, nunca URL bruta;
- 404/405 → instrumentar sem criar cardinalidade por path arbitrário;
- feature flag inexistente → métrica/log respeita contrato 019, sem habilitação acidental.

## Fora do escopo

- plataforma completa de Error Handling da 021;
- Idempotência da 022;
- tracing entre microserviços inexistentes;
- data lake/analytics de logs;
- SIEM completo;
- APM vendor-specific obrigatório;
- frontend Real User Monitoring completo;
- alerting/on-call/SLO contratual avançado;
- tabelas PostgreSQL para armazenar telemetria de alta frequência;
- qualquer fase posterior à 020.

## Critérios de conclusão

- OpenTelemetry inicializado de forma vendor-neutral e idempotente;
- request/correlation context propagado com AsyncLocalStorage;
- W3C Trace Context preservado;
- logs JSON estruturados e redigidos;
- traces HTTP e PostgreSQL seguros;
- métricas base e hooks de Feature Flags com cardinalidade controlada;
- resource attributes incluem serviço, ambiente e revision identity;
- exporter ausente/indisponível não derruba aplicação;
- health/database-health permanecem corretos;
- unit/architecture tests verdes;
- CI completo verde;
- Staging validado;
- rollback/restore comprovado;
- Production somente após gate humano explícito e aprovação externa efetiva;
- Production health/runtime evidence sem regressão;
- documentação, Issue e Confluence sincronizados.

## Próxima fase

A fase **021 — Error Handling** permanece `NOT ACTIVE` até a conclusão formal da 020.