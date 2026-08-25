# 018 — Configurações

## Estado

`ACTIVE / DEFINED`

A fase 018 é a primeira etapa funcional posterior à fundação 001–017 e aos hardenings P0/P1. Nenhuma fase posterior está ativa.

## Objetivo

Criar um subsistema empresarial de configurações para o Moventra TMS, com resolução hierárquica e auditável por Tenant, Empresa e Filial, sem transformar regras de negócio em um repositório genérico de chave/valor e sem armazenar secrets fora do boundary de Secrets Management.

A configuração deverá ser consumível pelos módulos futuros do TMS sem acoplamento ao frontend, ao provedor de deploy ou ao provedor de autenticação.

## Decisão arquitetural

A fase adota um **catálogo global de definições tipadas** e **valores tenant-scoped com overrides organizacionais**.

```text
Definition default
      ↓
Tenant override
      ↓
Company override
      ↓
Branch override
      ↓
Effective configuration
```

Precedência de resolução, da mais específica para a menos específica:

```text
BRANCH > COMPANY > TENANT > DEFINITION_DEFAULT
```

Ausência de override não é erro: o resolver sobe a hierarquia até encontrar valor aplicável. Configuração inexistente ou definição inativa falha de modo explícito; nunca deve ser silenciosamente convertida em `null` operacional.

## Responsabilidades

### `configuration.definitions`

Catálogo global do produto. Não possui `tenant_id`.

Responsabilidades:

- chave estável e única da configuração;
- descrição e domínio proprietário;
- tipo lógico do valor;
- valor default opcional;
- regras de validação estruturadas;
- scopes permitidos para override;
- classificação de sensibilidade;
- lifecycle e versão otimista.

Definições são governadas pela plataforma e não são CRUD arbitrário disponível ao usuário do Tenant.

### `configuration.settings`

Valor atual de uma definição em um scope organizacional específico.

Responsabilidades:

- `tenant_id` obrigatório;
- referência à definição global;
- scope `TENANT`, `COMPANY` ou `BRANCH`;
- `company_id` / `branch_id` coerentes com o scope;
- valor validado;
- status operacional;
- versão otimista;
- timestamps e identidade da alteração quando aplicável via Audit.

### `configuration.setting_versions`

Histórico append-only de alterações de um setting.

Responsabilidades:

- preservar versão de domínio, valor anterior/novo e motivo de mudança;
- permitir investigação e restauração controlada sem reescrever histórico;
- permanecer tenant-scoped e sujeito a RLS;
- complementar, não substituir, `audit.audit_events`.

Audit responde **quem/quando/resultado/contexto**; `setting_versions` preserva a evolução específica da configuração.

## Tipos suportados

O catálogo utiliza tipos lógicos, não tipos livres inferidos em runtime:

```text
BOOLEAN
INTEGER
DECIMAL
STRING
ENUM
JSON
DURATION
TIMEZONE
CURRENCY
```

O armazenamento físico pode usar `JSONB` para manter uma coluna homogênea, mas o domínio deve validar estritamente o valor contra `value_type` e contra as regras da definição antes da persistência.

`JSON` não significa payload irrestrito: deve possuir schema/shape e limites de tamanho/profundidade definidos.

## Modelo relacional alvo

### `configuration.definitions`

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
key TEXT NOT NULL UNIQUE
owner_domain TEXT NOT NULL
name TEXT NOT NULL
description TEXT NULL
value_type TEXT NOT NULL
default_value JSONB NULL
validation_schema JSONB NULL
allow_tenant_override BOOLEAN NOT NULL
allow_company_override BOOLEAN NOT NULL
allow_branch_override BOOLEAN NOT NULL
sensitivity TEXT NOT NULL
status TEXT NOT NULL
version BIGINT NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Regras:

- `key` é canônica, lowercase e dot-separated, por exemplo `operations.tracking.eta.enabled`;
- `owner_domain` indica o módulo responsável e evita um namespace global sem governança;
- `sensitivity` inicialmente: `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`;
- `SECRET` não é permitido como valor comum: secrets permanecem no store de secrets;
- `ACTIVE` e `INACTIVE` são suficientes para lifecycle inicial da definição;
- definição inativa não aceita novos overrides e não é resolvida para operação normal.

### `configuration.settings`

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
tenant_id UUID NOT NULL
configuration_definition_id UUID NOT NULL
scope_type TEXT NOT NULL
company_id UUID NULL
branch_id UUID NULL
value JSONB NOT NULL
status TEXT NOT NULL
version BIGINT NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Candidate key tenant-aware:

```text
UNIQUE (tenant_id, id)
```

Unicidade por scope deve ser garantida com índices parciais:

```text
TENANT  → uma linha ativa por tenant + definição
COMPANY → uma linha ativa por tenant + company + definição
BRANCH  → uma linha ativa por tenant + company + branch + definição
```

Coerência:

```text
TENANT  => company_id IS NULL AND branch_id IS NULL
COMPANY => company_id IS NOT NULL AND branch_id IS NULL
BRANCH  => company_id IS NOT NULL AND branch_id IS NOT NULL
```

FKs compostas devem impedir Company/Branch de outro Tenant:

```text
(tenant_id, company_id) → organization.companies
(tenant_id, company_id, branch_id) → organization.branches
```

### `configuration.setting_versions`

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
tenant_id UUID NOT NULL
setting_id UUID NOT NULL
setting_version BIGINT NOT NULL
value JSONB NULL
status TEXT NOT NULL
change_type TEXT NOT NULL
reason TEXT NULL
occurred_at TIMESTAMPTZ NOT NULL
```

Regras:

- append-only;
- `UNIQUE (tenant_id, setting_id, setting_version)`;
- FK `(tenant_id, setting_id)` para `configuration.settings`;
- UPDATE/DELETE bloqueados no banco;
- valor poderá ser `NULL` somente para uma revisão que represente remoção lógica/inativação, conforme contrato implementado.

## Lifecycle

### Definition

```text
ACTIVE → INACTIVE
INACTIVE → ACTIVE
```

### Setting

```text
ACTIVE → INACTIVE
INACTIVE → ACTIVE
```

Não haverá hard delete operacional. Remoção de override é modelada como inativação com histórico e Audit; o resolver então volta para o nível menos específico aplicável.

## Resolução efetiva

O resolver recebe obrigatoriamente:

```text
tenantId
configurationKey
companyId? 
branchId?
```

Regras:

1. valida Tenant e coerência Company/Branch;
2. carrega Definition `ACTIVE`;
3. procura override `BRANCH`, se branch foi informado e scope permitido;
4. procura override `COMPANY`;
5. procura override `TENANT`;
6. usa `default_value`, se definido;
7. caso nenhum valor exista, retorna erro de configuração ausente.

Resultado deve incluir provenance:

```json
{
  "key": "operations.tracking.eta.enabled",
  "value": true,
  "source": "BRANCH",
  "tenantId": "...",
  "companyId": "...",
  "branchId": "...",
  "settingId": "...",
  "settingVersion": 3,
  "definitionVersion": 1
}
```

Provenance é parte do contrato para diagnóstico e suporte.

## Regras de negócio

- um override só pode ser criado em scope permitido pela Definition;
- Company/Branch precisam pertencer ao Tenant informado;
- Branch precisa pertencer à Company informada;
- valores são validados antes da escrita e também ao carregar defaults versionados;
- update usa optimistic locking por `version`;
- toda alteração cria uma nova `setting_versions` na mesma transação;
- toda alteração crítica usa `AuthorizedTenantOperationService` e gera Audit SUCCESS atomicamente;
- DENIED/FAILED seguem o contrato P1;
- configuração de outro Tenant nunca é visível, mesmo quando um UUID válido é conhecido;
- resolução não aceita `tenant_id`, `company_id` ou `branch_id` do cliente como autorização: são apenas alvo de recurso após o principal ser autenticado/autorizado;
- settings inativos são ignorados pelo resolver;
- default global não pode conter dado específico de cliente.

## RBAC e Organizational Scope

Permissões iniciais previstas:

```text
configuration.settings.read
configuration.settings.manage
```

Leitura e alteração são avaliadas no backend.

Scope mínimo esperado:

```text
TENANT setting  → cobertura Tenant
COMPANY setting → cobertura da Company alvo
BRANCH setting  → cobertura da Branch alvo
```

A Definition é catálogo de plataforma. Alterar Definition por usuário tenant-scoped não faz parte da 018.

## RLS

`configuration.settings` e `configuration.setting_versions` são tenant-scoped e devem possuir RLS usando `security.current_tenant_id()`.

`configuration.definitions` é global e não recebe RLS tenant-based.

A role de runtime precisa somente dos privilégios mínimos necessários. Não deve receber `CREATE` no schema `configuration` nem DELETE nas tabelas operacionais/históricas.

## Auditoria e LGPD

Eventos relevantes:

```text
configuration.setting.created
configuration.setting.updated
configuration.setting.activated
configuration.setting.inactivated
configuration.setting.restored
```

Antes/after podem ser registrados no Audit somente quando a `sensitivity` permitir. Valores `CONFIDENTIAL` devem ser minimizados/redigidos conforme contrato do domínio; logs nunca devem imprimir valor integral por padrão.

Configurações não podem ser usadas para armazenar:

- passwords;
- tokens;
- API keys;
- private keys;
- DATABASE_URL;
- credentials de bancos, gateways ou integrações.

Esses dados continuam exclusivamente no Secrets Management.

## API alvo

### Resolver configuração efetiva

```text
GET /api/v1/configuration/effective/{key}
```

Filtros/contexto:

```text
companyId?
branchId?
```

Autorização: `configuration.settings.read` + Organizational Scope.

### Criar/alterar override

```text
PUT /api/v1/configuration/settings/{key}
```

Payload conceitual:

```json
{
  "scope": {
    "type": "BRANCH",
    "companyId": "...",
    "branchId": "..."
  },
  "value": true,
  "expectedVersion": 2,
  "reason": "Habilitar ETA para a filial"
}
```

Para criação, `expectedVersion` não é informado; para alteração é obrigatório.

Idempotência deve ser suportada quando a API de escrita for exposta publicamente, usando idempotency key no boundary HTTP sem substituir optimistic locking.

## Cache e consistência

A fonte de verdade é PostgreSQL.

Cache de resolução pode ser adicionado depois da correção funcional inicial, com chave que inclua Tenant + Company + Branch + configuration key. Qualquer cache deve possuir invalidação determinística após commit e nunca cruzar Tenant.

O primeiro release da fase não dependerá de cache para correção ou disponibilidade.

## Observabilidade

Métricas/logs devem distinguir, sem expor PII ou valores confidenciais:

```text
configuration_resolution_total
configuration_resolution_missing_total
configuration_resolution_source{source}
configuration_write_total{scope,outcome}
configuration_validation_failure_total
```

Logs estruturados podem registrar key, scope, request/correlation IDs e versões, nunca valor sensível por padrão.

## Migração e validação

A implementação deve introduzir migration canônica e validation correspondente, preservando o histórico existente 0001–0011.

Antes de aplicar em Neon:

- CI limpo PostgreSQL 18;
- migrations idempotentes pelo runner canônico;
- constraints e índices verificados;
- runtime role least-privilege atualizada;
- RLS e cross-tenant smoke executados;
- Audit e histórico append-only comprovados.

Depois:

```text
Neon Staging
→ smoke / cleanup
→ Staging application release
→ rollback / restore
→ gate humano Production
→ Neon Main + Production conforme ordem segura da release
```

Qualquer mudança de banco Production precisa ser compatível com o artefato anterior durante o intervalo de rollout ou possuir estratégia expand/contract equivalente.

## Fora do escopo da 018

- armazenamento de secrets;
- feature flag platform dedicada para rollout experimental;
- configuração específica de um único módulo de negócio ainda inexistente;
- UI administrativa completa;
- sistema de templates de comunicação;
- billing SaaS;
- preferências pessoais de User que não sejam configuração organizacional;
- criação de uma fase posterior por inferência.

## Critérios de conclusão

- catálogo global tipado materializado;
- settings tenant/company/branch materializados com constraints de coerência;
- histórico append-only materializado;
- resolver de precedência comprovado;
- RBAC + Organizational Scope + RLS + Audit integrados pelo pipeline P1;
- runtime PostgreSQL continua least-privilege/NOBYPASSRLS;
- cross-tenant read/write bloqueados;
- optimistic locking e concorrência testados;
- secrets proibidos pelo contrato;
- CI, Neon Staging/Main, Staging, rollback/restore e Production evidenciados;
- nenhum dado de smoke permanece;
- documentação/Issue/Confluence sincronizados.
