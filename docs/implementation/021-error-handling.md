# 021 — Error Handling

## Estado

`CONCLUDED`

A fase 021 foi concluída após implementação, CI, Staging, rollback/restore e promoção protegida para Production da revisão funcional `e23cff77cd1af4b590fd3bf9ceac98e1cca4e5dc`. A fase 022 — Idempotência passa a ser a única etapa funcional `ACTIVE / DEFINED`; a 023 — Outbox e todas as posteriores permanecem `NOT ACTIVE`.

## Evidência de conclusão

```text
Issue                         = #98
PR técnica                    = #99
functional/runtime revision   = e23cff77cd1af4b590fd3bf9ceac98e1cca4e5dc
source CI run                 = 32879964993 = success
Release Gate / Staging        = 32880111232 = success
Rollback Drill                = 32880277853 = success
Production Promotion          = 32880504603 = success
Production deployment         = dpl_8g1qdBw99RyZePkKJqm8CCCjGyJj = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
artifact_sha256               = e352490006a3b4dbacb7aef758279e9cd00dd71bc9cb6c9650347d459cfc1106
production evidence artifact  = production-deployment-e23cff77cd1af4b590fd3bf9ceac98e1cca4e5dc
production evidence digest    = e7aa9f4503279828ef91baf3c8519ebd77a41fd67feed2da00c3a386e236abfc
```

Revision identity e database readiness passaram no deployment imutável e no alias estável. O mesmo artefato comprovado no rollback foi promovido a Production. A fase não criou migration PostgreSQL nem tabela de erros.

## Objetivo

Estabelecer um contrato transversal, seguro, previsível e observável para erros do Moventra TMS, cobrindo domínio, aplicação, HTTP/API, infraestrutura e integrações sem expor detalhes sensíveis e sem transformar falhas técnicas em regras de negócio.

O contrato permite responder consistentemente:

```text
qual categoria de erro ocorreu?
qual código estável pode ser tratado pelo cliente?
qual status HTTP é correto?
o erro é retryable?
qual request/correlation/trace identifica a ocorrência?
qual mensagem é segura para o consumidor?
qual detalhe permanece somente em telemetria interna?
```

## Princípios

1. Erros de domínio são explícitos e independentes de HTTP.
2. Controllers/adapters convertem erros para o protocolo externo.
3. Erros públicos usam códigos estáveis; mensagens humanas podem evoluir.
4. Stack trace, SQL, tokens, DSNs, headers sensíveis e detalhes internos nunca são retornados ao cliente.
5. `requestId`, `correlationId` e trace context da fase 020 são preservados.
6. Audit continua separado de telemetria e de resposta HTTP.
7. Retryability é declarada por categoria/causa, não inferida da mensagem.
8. Erro inesperado falha de forma segura com resposta genérica e diagnóstico interno suficiente.
9. Multi-tenancy, RBAC e RLS não podem vazar existência de recursos entre escopos não autorizados.
10. A fase 022 — Idempotência não foi antecipada durante a implementação da 021.

## Taxonomia canônica

A aplicação normaliza erros em categorias pequenas e estáveis:

```text
ValidationError
DomainRuleError
AuthenticationError
AuthorizationError
NotFoundError
ConflictError
ConcurrencyError
RateLimitError
DependencyError
TimeoutError
InfrastructureError
UnexpectedError
```

### ValidationError

Entrada sintaticamente ou estruturalmente inválida.

Exemplos:

- campo obrigatório ausente;
- formato inválido;
- valor fora de faixa;
- payload excede limite.

HTTP padrão: `400` ou `422` conforme contrato da operação.

### DomainRuleError

A entrada é válida, mas viola regra/invariante de negócio.

Exemplos futuros:

- transição de estado não permitida;
- recurso inelegível;
- operação proibida pelo estado atual.

HTTP padrão: `422` quando a semântica não permitir execução.

### AuthenticationError

Identidade não autenticada ou assertion/sessão inválida.

HTTP: `401`.

### AuthorizationError

Identidade autenticada sem permissão/escopo suficiente.

HTTP: `403`, salvo política de anti-enumeração que exija resposta indistinguível de `404`.

### NotFoundError

Recurso inexistente dentro do escopo autorizado.

HTTP: `404`.

### ConflictError

Conflito com estado persistido ou unicidade.

HTTP: `409`.

### ConcurrencyError

Optimistic locking/version mismatch ou corrida que invalida o comando.

HTTP: `409`.

### RateLimitError

Limite técnico/contratual excedido.

HTTP: `429`, com `Retry-After` somente quando calculado por fonte confiável.

### DependencyError

Falha de serviço externo/dependência necessária.

HTTP público normalmente `502` ou `503` conforme natureza; detalhes do provider permanecem internos.

### TimeoutError

Timeout controlado de dependência/operação.

HTTP público normalmente `504` para dependência upstream ou contrato equivalente.

### InfrastructureError

Falha interna conhecida de infraestrutura sem semântica de domínio.

HTTP: `500` ou `503` conforme disponibilidade.

### UnexpectedError

Erro não classificado.

HTTP: `500` com mensagem pública genérica e observabilidade interna enriquecida.

## Código estável de erro

Cada erro público possui `code` estável, namespaced e independente da mensagem:

```text
VALIDATION.INVALID_INPUT
AUTHENTICATION.REQUIRED
AUTHORIZATION.DENIED
RESOURCE.NOT_FOUND
RESOURCE.CONFLICT
CONCURRENCY.VERSION_MISMATCH
DEPENDENCY.UNAVAILABLE
DEPENDENCY.TIMEOUT
INTERNAL.UNEXPECTED
```

Regras:

- `code` é contrato de máquina;
- `title`/mensagem pode ser localizada futuramente;
- não incluir IDs dinâmicos no código;
- não criar código distinto para cada mensagem SQL/provider;
- códigos removidos devem ser tratados como breaking change quando expostos externamente.

## Problem Details

APIs HTTP convergem para `application/problem+json`, compatível com RFC 9457/Problem Details, usando extensão Moventra controlada.

Formato:

```json
{
  "type": "https://api.moventra/errors/RESOURCE.NOT_FOUND",
  "title": "Recurso não encontrado",
  "status": 404,
  "detail": "O recurso solicitado não foi encontrado.",
  "instance": "/api/v1/resource",
  "code": "RESOURCE.NOT_FOUND",
  "requestId": "...",
  "correlationId": "..."
}
```

Campos opcionais controlados:

```text
errors[]       = validações por campo, sem ecoar payload sensível
retryable      = apenas quando útil ao cliente e seguro
retryAfter     = somente quando confiável
```

Não retornar:

```text
stack
SQL
connection string
provider token
Authorization/Cookie
internal class name desnecessário
filesystem path
raw assertion
raw request body
cross-tenant identifier não autorizado
```

## Validação por campo

Para erros de validação, usar estrutura previsível:

```json
{
  "code": "VALIDATION.INVALID_INPUT",
  "errors": [
    {
      "field": "name",
      "code": "REQUIRED",
      "message": "Campo obrigatório."
    }
  ]
}
```

O nome do campo deve pertencer ao contrato público. Não expor nome de coluna, constraint ou caminho interno quando divergir do DTO/API.

## Mapeamento domínio → HTTP

Domínio não conhece status HTTP.

Fluxo:

```text
Domain/Application Error
→ Error Normalizer
→ Protocol Mapper
→ Problem Details
→ Observability
```

O mapper HTTP centraliza status e representação pública. Controllers não repetem `try/catch` com mapeamentos diferentes por rota.

## PostgreSQL e constraints

Erros PostgreSQL conhecidos podem ser traduzidos quando existir semântica segura e determinística.

Exemplos:

```text
unique violation conhecida       → ConflictError
foreign key conhecida            → Validation/Conflict conforme comando
serialization/deadlock           → Concurrency/Infrastructure conforme política
connection unavailable           → Dependency/Infrastructure
```

Regras:

- nunca devolver texto bruto de erro PostgreSQL;
- constraint name só é usada internamente para mapping allowlisted;
- erro desconhecido cai em `InfrastructureError`/`UnexpectedError`;
- nenhuma tradução pode ignorar tenant/RLS/authorization.

## Concorrência

A fase respeita `version`/optimistic locking definido nas convenções.

Version mismatch:

```text
code = CONCURRENCY.VERSION_MISMATCH
HTTP = 409
retryable = false por padrão pelo cliente sem re-fetch
```

Deadlock/serialization failure pode ser retryable internamente quando a operação for segura, mas a política de retry transversal não antecipa a fase 022 nem duplica efeitos colaterais.

## Segurança e anti-enumeração

Para recursos tenant-scoped, a resposta não pode revelar que um registro existe em outro Tenant.

Exemplo:

```text
Tenant A solicita ID pertencente ao Tenant B
→ autorização/RLS impede acesso
→ resposta pública não confirma existência cross-tenant
```

A política entre `403` e `404` preserva o boundary de autorização e é coberta por testes cross-tenant.

## Observabilidade

Todo erro normalizado integra-se à fase 020.

Campos internos mínimos:

```text
error.type
error.code
outcome
requestId
correlationId
traceId
spanId
route
method
statusCode
```

Regras:

- erros esperados 4xx não são todos logados como `error`;
- 5xx inesperados produzem diagnóstico estruturado sanitizado;
- span recebe status de erro quando aplicável;
- métricas usam apenas dimensões de baixa cardinalidade;
- `error.code` pode ser label apenas se o catálogo permanecer controlado;
- mensagem arbitrária/stack/UUID nunca vira label de métrica.

## Audit

Nem todo erro gera Audit.

Audit é obrigatório quando a tentativa constitui evento de segurança/negócio relevante já previsto pela fase 017, por exemplo alteração sensível negada ou ação administrativa crítica. Falha técnica de health/exporter não deve poluir Audit de negócio.

## Retry classification

O erro interno pode carregar classificação:

```text
retryable = true|false
retryStrategy = none|immediate|backoff|external-reconcile
```

Na fase 021, isso é metadado para consumidores internos. Não foi implementada engine de retries, idempotency key store ou exactly-once lógico.

## APIs internas

```text
src/core/errors/app-error.js
src/core/errors/error-codes.js
src/core/errors/error-normalizer.js
src/http/problem-details.js
src/http/error-mapper.js
```

Contrato base conceitual:

```text
AppError {
  code
  category
  message
  publicMessage
  retryable
  cause
  metadataSafe
}
```

`cause` nunca é serializado diretamente para o cliente.

## Compatibilidade e versionamento

- adicionar código novo é compatível quando não altera contrato existente;
- trocar status HTTP/código existente pode ser breaking change;
- `type` URI deve ser estável;
- documentação OpenAPI futura deve referenciar o mesmo envelope;
- APIs internas não expõem stack por ambiente apenas porque Production está em debug.

## Internacionalização

A fase não exige tradução completa, mas separa código de máquina de mensagem humana para permitir i18n futura. O cliente não depende do texto exato da mensagem para lógica.

## Testes obrigatórios

Unitários:

- cada categoria mapeia para status esperado;
- erro desconhecido vira `INTERNAL.UNEXPECTED`;
- Problem Details não contém stack/cause/raw provider errors;
- validation errors usam campos allowlisted;
- requestId/correlationId são propagados;
- códigos são estáveis e únicos;
- retryability não é inferida de mensagem.

Arquiteturais:

- domínio não depende de HTTP;
- controllers usam mapper central;
- nenhuma rota retorna stack/SQL/DSN/token;
- fase 022 não foi antecipada;
- observabilidade continua vendor-neutral;
- Audit e error telemetry permanecem separados.

Integração/PostgreSQL:

- unique violation allowlisted → 409 seguro;
- constraint desconhecida → erro interno sanitizado;
- conexão indisponível → resposta controlada sem segredo;
- optimistic lock mismatch → 409;
- RLS/cross-tenant não vaza existência.

Runtime:

- `/health` e `/api/database-health` preservam contratos vigentes;
- 404/405 usam envelope consistente quando aplicável ao boundary atual;
- 500 simulado não retorna stack;
- logs possuem `error.code` + correlação;
- Production permanece sem regressão após gate protegido.

## CI/CD

A CI valida:

```text
error contract tests
problem details contract
security redaction
architecture boundaries
runtime import
build immutable artifact
```

Mudanças runtime-impacting seguem:

```text
CI
→ immutable artifact
→ Staging
→ rollback/restore
→ protected Production approval
→ same artifact
→ revision identity
→ database readiness
→ runtime observability
→ production evidence
```

## Banco de dados

A fase 021 não requer migration. Não existe tabela de erros: erros operacionais pertencem à telemetria; fatos de negócio/segurança relevantes pertencem ao Audit existente.

## Casos de borda

- erro lançado como string/objeto arbitrário → normalizar para `UnexpectedError`;
- `cause` circular → logger/normalizer não quebra;
- mensagem com token/DSN → redaction antes de log público/interno;
- erro após headers enviados → evitar segunda resposta e registrar ocorrência;
- client disconnect → classificar sem gerar falso 500 quando possível;
- timeout upstream → não expor hostname/credencial;
- constraint PostgreSQL nova/desconhecida → fail-safe sanitizado;
- recurso cross-tenant → não enumerar;
- payload inválido enorme → resposta limitada;
- erro no próprio error handler → fallback mínimo seguro.

## Fora do escopo da 021

- Idempotency-Key store e request fingerprint da 022;
- retries transacionais automáticos generalizados;
- Outbox da 023;
- mensageria/DLQ;
- catálogo de erros tenant-configurável;
- páginas frontend de erro;
- suporte/incident management completo.

## Critérios de conclusão

- taxonomia canônica de erros implementada;
- códigos públicos estáveis e únicos;
- Problem Details centralizado e seguro;
- mapeamento domínio→HTTP centralizado;
- validação por campo padronizada;
- erros PostgreSQL conhecidos traduzidos por allowlist;
- unknown errors sanitizados;
- retry classification explícita sem antecipar Idempotência;
- request/correlation/trace preservados;
- observabilidade e Audit integrados sem duplicação indevida;
- testes unitários/arquiteturais/integração verdes;
- cross-tenant anti-enumeração validada;
- CI completo verde;
- Staging validado;
- rollback/restore comprovado;
- Production após gate humano explícito e aprovação externa efetiva;
- Production evidence sem regressão;
- documentação e Issue sincronizadas; Confluence é atualizado na transição de governança.

## Próxima fase

A fase **022 — Idempotência = ACTIVE / DEFINED**. Sua implementação deve seguir `docs/implementation/022-idempotencia.md`. A fase **023 — Outbox** permanece `NOT ACTIVE` até a conclusão formal da 022.