# Moventra TMS — Matriz Mestre de Variáveis

## 1. Objetivo

Esta é a fonte canônica de inventário lógico das variáveis de configuração do Moventra TMS.

A matriz registra, para cada variável relevante:

**Sistema → Ambiente → variável → tipo → valor/default → secret → origem → consumidor → status → divergência → ação.**

Ela complementa:

- `.env.example`: contrato de nomes do runtime/automação, sempre sem valores;
- `docs/security/SECRETS-POLICY.md`: classificação, armazenamento, rotação e auditoria;
- workflows em `.github/workflows/`: contrato executável de CI/CD;
- código em `src/`: validação e defaults efetivos.

## 2. Regras de segurança e leitura

- valores reais de secrets nunca são registrados nesta matriz;
- `PRESENTE — MASCARADO` significa que a existência foi validada, mas o valor não deve ser exposto;
- defaults só são considerados canônicos quando implementados no código;
- variáveis automáticas de plataforma são inventariadas separadamente e não entram no `.env.example` salvo dependência explícita do código;
- IDs públicos podem ser registrados para rastreabilidade;
- o estado externo é um **snapshot auditável em 2026-08-27** e deve ser revalidado após mudanças de infraestrutura/release.

### Status

| Status | Significado |
|---|---|
| ✅ OK | contrato e estado observado coerentes |
| ✅ DEFAULT | ausência explícita é válida porque existe default seguro no código |
| ⚠️ ATENÇÃO | divergência, drift, legado ou hardening pendente |
| ❓ NÃO VERIFICADO | conector/fonte atual não permite confirmar o valor/estado |
| ⛔ AUSENTE | obrigatório e comprovadamente ausente |
| ♻️ LEGADO | não pertence mais ao contrato canônico |

---

# 3. GitHub Actions / Environments

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| GitHub | staging | `VERCEL_TOKEN` | secret/token | PRESENTE — MASCARADO | sim | GitHub Environment `staging` | Bootstrap / Release Gate / Rollback Drill | ✅ OK | nenhuma confirmada | manter segregado e rotacionável |
| GitHub | production | `VERCEL_TOKEN` | secret/token | PRESENTE — MASCARADO | sim | GitHub Environment `production` | Production Promotion | ✅ OK | nenhuma confirmada | manter independente de Staging |
| GitHub | staging | `VERCEL_ORG_ID` | var/public config | `team_3JTmWy5Z7vLfh2OqOwuFZp1G` | não | GitHub Environment var | automação Vercel | ✅ OK | nenhuma | manter |
| GitHub | production | `VERCEL_ORG_ID` | var/public config | `team_3JTmWy5Z7vLfh2OqOwuFZp1G` | não | GitHub Environment var | Production Promotion | ✅ OK | nenhuma | manter |
| GitHub | production | `VERCEL_PRODUCTION_PROJECT_ID` | var/public config | `prj_5qFenjyeGE1joaGomaNrUIRGSBQs` | não | GitHub Environment var | Production Promotion | ✅ OK | nenhuma | manter e validar contra projeto resolvido |
| GitHub | staging | `VERCEL_STAGING_PROJECT_ID` | var/public config | não requerido | não | legado | nenhum consumidor canônico | ♻️ LEGADO | `.env.example` antigo ainda declarava o nome | removido do contrato ativo; Staging é resolvido por nome |
| GitHub | staging | `DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | GitHub Environment secret | Release Gate / sync Vercel | ✅ OK | nenhuma | manter role de runtime e menor privilégio |
| GitHub | production | `DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | GitHub Environment secret | Production Promotion / runtime Vercel | ✅ OK | nenhuma | manter role de runtime e menor privilégio |
| GitHub | staging | `MIGRATIONS_DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | GitHub Environment secret | aplicação governada de migrations | ✅ OK | faltava no `.env.example`; política usava nomenclatura divergente | normalizado como nome canônico |
| GitHub | production | `MIGRATIONS_DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | GitHub Environment secret | Production Promotion / migrations | ✅ OK | faltava no `.env.example`; política usava nomenclatura divergente | normalizado como nome canônico |
| GitHub | staging | `MESSAGING_RABBITMQ_URL` | AMQPS connection string | PRESENTE — MASCARADO | sim | GitHub Environment secret | Release Gate / smoke / sync Vercel | ✅ OK | nenhuma | manter TLS `amqps://` |
| GitHub | production | `MESSAGING_RABBITMQ_URL` | AMQPS connection string | PRESENTE — MASCARADO | sim | GitHub Environment secret | Production Promotion / smoke / sync Vercel | ✅ OK | nenhuma | manter TLS `amqps://` |
| GitHub | job | `GITHUB_TOKEN` | credencial efêmera | emitida por job | sim/efêmera | GitHub Actions | chamadas GitHub REST | ✅ OK | nenhuma | manter permissions mínimas e não persistir |

---

# 4. Vercel

## 4.1 Identificadores de projeto

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Vercel | global | `VERCEL_ORG_ID` | public config | `team_3JTmWy5Z7vLfh2OqOwuFZp1G` | não | GitHub var / Vercel team | scripts de deploy | ✅ OK | nenhuma | manter |
| Vercel | production | `VERCEL_PRODUCTION_PROJECT_ID` | public config | `prj_5qFenjyeGE1joaGomaNrUIRGSBQs` | não | GitHub var | Production Promotion | ✅ OK | nenhuma | manter |
| Vercel | staging | Project ID resolvido | public config | `prj_NYeCYXZur3CPG1sS1wC81ffKBkoU` | não | `ensure-vercel-project.sh` | Release Gate / Rollback Drill | ✅ OK | não deve existir dependência estática em `VERCEL_STAGING_PROJECT_ID` | continuar resolução dinâmica |
| Vercel | production | projeto | identificador | `moventra-tms` | não | Vercel | runtime/deploy | ✅ OK | nenhuma | manter |
| Vercel | staging | projeto | identificador | `moventra-tms-staging` | não | Vercel | runtime/deploy | ✅ OK | nenhuma | manter |
| Vercel | production/staging | Node runtime | runtime config | `22.x` | não | Vercel project policy | Functions | ✅ OK | nenhuma | manter pinado |

## 4.2 Runtime da aplicação

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Vercel | production | `DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | GitHub Production → sync Vercel | API/database health | ✅ OK | nenhuma | manter |
| Vercel | staging | `DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | GitHub Staging → sync Vercel | API/database health | ✅ OK | nenhuma | manter |
| Vercel | production | `MIGRATIONS_DATABASE_URL` | migration credential | **não deve existir no runtime** | sim | GitHub control plane | nenhum runtime | ✅ OK por contrato | risco caso seja sincronizada para runtime | manter proibida no runtime |
| Vercel | staging | `MIGRATIONS_DATABASE_URL` | migration credential | **não deve existir no runtime** | sim | GitHub control plane | nenhum runtime | ✅ OK por contrato | risco caso seja sincronizada para runtime | manter proibida no runtime |
| Vercel | production | `MOVENTRA_ENV` | enum/string | `production` | não | release automation | logging/config | ✅ OK | nenhuma | manter |
| Vercel | staging | `MOVENTRA_ENV` | enum/string | `staging` | não | release automation | logging/config | ✅ OK | nenhuma | manter |
| Vercel | production | `APP_VERSION` | revision identity | SHA do artefato imutável | não | wrapper gerado no build | health/observability | ✅ OK por desenho | versão efetiva pode ficar atrás de `main` até promoção | promover somente via gate |
| Vercel | staging | `APP_VERSION` | revision identity | SHA do artefato imutável | não | wrapper gerado no build | health/observability | ✅ OK | nenhuma estrutural | manter |
| Vercel | production/staging | `DB_POOL_MAX` | integer | default `5` | não | código `postgres.js` | pool PostgreSQL | ✅ DEFAULT | nenhuma | declarar apenas se tuning exigir |
| Vercel | production/staging | `DB_POOL_IDLE_TIMEOUT_MS` | integer/ms | default `10000` | não | código `postgres.js` | pool PostgreSQL | ✅ DEFAULT | nenhuma | declarar apenas se tuning exigir |
| Vercel | production/staging | `DB_CONNECTION_TIMEOUT_MS` | integer/ms | default `5000` | não | código `postgres.js` | pool PostgreSQL | ✅ DEFAULT | nenhuma | declarar apenas se tuning exigir |
| Vercel | production/staging | `MESSAGING_PROVIDER` | enum | explicitamente `rabbitmq` | não | release automation | RabbitMQ adapter | ✅ OK | comentário antigo dizia default `rabbitmq`, mas código default é `disabled` | comentário corrigido; manter explicitamente `rabbitmq` fora de local/CI |
| Vercel | production/staging | `MESSAGING_RABBITMQ_URL` | AMQPS connection string | PRESENTE — MASCARADO | sim | GitHub Environment → sync Vercel | RabbitMQ adapter/Admin smoke | ✅ OK | nenhuma | manter TLS |
| Vercel | production/staging | `MESSAGING_EXCHANGE` | string | default `moventra.events` | não | código | messaging adapter | ✅ DEFAULT | nenhuma | manter default salvo necessidade operacional |
| Vercel | production/staging | `MESSAGING_PREFETCH` | integer | default `20` | não | código | messaging adapter | ✅ DEFAULT | nenhuma | ajustar somente por capacidade medida |
| Vercel | production/staging | `MESSAGING_PUBLISH_CONFIRM_TIMEOUT_MS` | integer/ms | default `5000` | não | código | publisher confirm | ✅ DEFAULT | nenhuma | manter |

## 4.3 Trust contract JWT

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Vercel | production/staging | `MOVENTRA_AUTH_PROVIDER_KEY` | string | `neon-auth` | não | `config/auth/neon-auth.json` → release sync | bearer JWT boundary | ✅ OK por contrato | smoke final de Staging ainda precisa permanecer verde | manter sync governado |
| Vercel | production | `MOVENTRA_AUTH_JWT_ISSUER` | public URL | Neon Auth Production issuer | não | config canônica → release sync | JWT validation | ✅ OK por contrato | estado runtime deve ser revalidado após promoção | validar no release gate |
| Vercel | staging | `MOVENTRA_AUTH_JWT_ISSUER` | public URL | Neon Auth Staging issuer | não | config canônica → release sync | JWT validation | ✅ OK por contrato | gate autenticado deve permanecer verde | manter smoke |
| Vercel | production/staging | `MOVENTRA_AUTH_JWT_AUDIENCE` | public URL | igual ao issuer no adapter atual | não | config canônica → release sync | JWT validation | ✅ OK | nenhuma estrutural | manter provider-neutral no boundary |
| Vercel | production/staging | `MOVENTRA_AUTH_JWT_ALGORITHM` | enum | `EdDSA` | não | config canônica → release sync | JWT validation | ✅ OK | nenhuma | manter allowlist estrita |
| Vercel | production/staging | `MOVENTRA_AUTH_JWT_SUBJECT_CLAIMS` | lista ordenada/string | `sub,id` | não | `config/auth/neon-auth.json` → release sync | resolução de subject no bearer JWT boundary e release smoke | ✅ OK após correção | era consumida/sincronizada pelo runtime, mas faltava no `.env.example` e nesta matriz; smoke local também não propagava o contrato | manter ordem canônica `sub,id`, allowlist explícita e fail-closed |
| Vercel | production/staging | `MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM` | public key | snapshot PEM público | não | JWKS → release sync | JWT fallback/trust | ✅ OK | nunca pode conter private key | manter validação anti-private-key |
| Vercel | production/staging | `MOVENTRA_AUTH_JWT_JWKS_URL` | public HTTPS URL | endpoint Neon Auth do ambiente | não | config canônica → release sync | JWT validation/rotation | ✅ OK | nenhuma | manter HTTPS e rotação por `kid` |

---

# 5. Neon / PostgreSQL

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Neon | production | `DATABASE_URL` | runtime credential | PRESENTE — MASCARADO | sim | role runtime na branch `main` | Vercel API / Worker conforme workload | ✅ OK | conexão pública do projeto ainda requer hardening | manter menor privilégio; avaliar rede/allowlist |
| Neon | staging | `DATABASE_URL` | runtime credential | PRESENTE — MASCARADO | sim | role runtime na branch `staging` | Vercel Staging / Worker Staging | ✅ OK | conexão pública do projeto ainda requer hardening | manter segregação por ambiente |
| Neon | production | `MIGRATIONS_DATABASE_URL` | migration/control plane | PRESENTE — MASCARADO | sim | role de migration na branch `main` | GitHub Production Promotion | ✅ OK | nome documental anteriormente divergente | nome normalizado; nunca expor ao runtime |
| Neon | staging | `MIGRATIONS_DATABASE_URL` | migration/control plane | PRESENTE — MASCARADO | sim | role de migration na branch `staging` | GitHub Release Gate | ✅ OK | nome documental anteriormente divergente | nome normalizado; nunca expor ao runtime |
| Neon | project | Project ID | public config | `shiny-mode-01639948` | não | Neon | administração/auditoria | ✅ OK | nenhuma | manter como metadata, não como secret |
| Neon | production | Branch ID | public config | `br-morning-glitter-au97suq4` | não | Neon | administração/auditoria | ⚠️ ATENÇÃO | branch observada com `protected=false` | avaliar proteção de `main` |
| Neon | staging | Branch ID | public config | `br-rapid-math-au6j6xut` | não | Neon | administração/auditoria | ⚠️ ATENÇÃO | branch observada com `protected=false` | avaliar proteção de Staging |

---

# 6. RabbitMQ / Mensageria

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| RabbitMQ | staging/production | `MESSAGING_PROVIDER` | enum | runtime governado=`rabbitmq`; default código=`disabled` | não | release automation + código | API/Worker messaging | ✅ OK após correção documental | comentário antigo do `.env.example` contradizia código | corrigido; manter fail-safe `disabled` como default |
| RabbitMQ | staging/production | `MESSAGING_RABBITMQ_URL` | AMQPS URL | PRESENTE — MASCARADO | sim | GitHub/Vercel/Railway secret stores | producer/consumer/smokes | ✅ OK | nenhuma | exigir `amqps://` |
| RabbitMQ | staging/production | `MESSAGING_EXCHANGE` | string | default `moventra.events` | não | código | producer/consumer | ✅ DEFAULT | nenhuma | manter |
| RabbitMQ | staging/production | `MESSAGING_PREFETCH` | integer | default `20` | não | código | consumer | ✅ DEFAULT | nenhuma | tuning somente com métricas |
| RabbitMQ | staging/production | `MESSAGING_PUBLISH_CONFIRM_TIMEOUT_MS` | integer/ms | default `5000` | não | código | publisher confirm | ✅ DEFAULT | nenhuma | manter |
| RabbitMQ/DLQ | staging/production | `DLQ_RABBITMQ_DLX` | string | default `moventra.dlx` | não | código | DLQ topology | ✅ DEFAULT | nenhuma | manter |
| RabbitMQ/DLQ | staging/production | `DLQ_RABBITMQ_QUEUE` | string | default `moventra.dlq.ingest` | não | código | DLQ ingestion consumer | ✅ DEFAULT | nenhuma | manter |
| RabbitMQ/DLQ | staging/production | `DLQ_RABBITMQ_PREFETCH` | integer | default `10` | não | código | DLQ ingestion consumer | ✅ DEFAULT | nenhuma | tuning somente com métricas |
| RabbitMQ/DLQ | staging/production | `DLQ_INGEST_PERSIST_RETRIES` | integer | default `5` | não | código | DLQ ingestion persistence | ✅ DEFAULT | nenhuma | manter |
| RabbitMQ/DLQ | staging/production | `DLQ_INGEST_RETRY_BASE_MS` | integer/ms | default `250` | não | código | backoff DLQ | ✅ DEFAULT | nenhuma | manter |
| RabbitMQ/DLQ | staging/production | `DLQ_INGEST_RETRY_MAX_MS` | integer/ms | default `5000` | não | código | backoff DLQ | ✅ DEFAULT | nenhuma | manter |

---

# 7. Railway — Worker dedicado

## 7.1 Production

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Railway | production | `DATABASE_URL` | PostgreSQL connection string | PRESENTE — MASCARADO | sim | Railway service variable | Worker/Jobs/Outbox/DLQ | ✅ OK | nenhuma | manter principal dedicado |
| Railway | production | `MESSAGING_RABBITMQ_URL` | AMQPS connection string | PRESENTE — MASCARADO | sim | Railway service variable | Worker RabbitMQ | ✅ OK | nenhuma | manter TLS |
| Railway | production | `MESSAGING_PROVIDER` | enum | presente; Worker exige `rabbitmq` | não | Railway variable | Worker startup | ✅ OK | nenhuma | manter explícito |
| Railway | production | `MOVENTRA_ENV` | enum | `production` observado | não | Railway variable | logging/config | ✅ OK | nenhuma | manter |
| Railway | production | `MOVENTRA_RELEASE_SHA` | revision | SHA implantado | não | release/deploy config | logger + telemetry | ✅ OK após correção de contrato | telemetry OTEL ignorava esta variável | código corrigido para priorizar `MOVENTRA_RELEASE_SHA` |
| Railway | production | `NODE_ENV` | enum | presente | não | Railway variable | Node/runtime | ✅ OK | valor não retornado pelo conector | manter coerente com Production |
| Railway | production | `JOBS_BATCH_SIZE` | integer | presente; default código `25` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter/tunar com métricas |
| Railway | production | `JOBS_CONCURRENCY` | integer | presente; default `5` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter/tunar com métricas |
| Railway | production | `JOBS_LEASE_MS` | integer/ms | presente; default `60000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter |
| Railway | production | `JOBS_HEARTBEAT_MS` | integer/ms | presente; default `20000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter relação heartbeat < lease |
| Railway | production | `JOBS_IDLE_POLL_MS` | integer/ms | presente; default `1000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter |
| Railway | production | `JOBS_IDLE_POLL_MAX_MS` | integer/ms | presente; default `5000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter |
| Railway | production | `JOBS_HANDLER_TIMEOUT_MS` | integer/ms | presente; default `30000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter |
| Railway | production | `JOBS_RETRY_BASE_MS` | integer/ms | presente; default `1000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter |
| Railway | production | `JOBS_RETRY_MAX_MS` | integer/ms | presente; default `300000` | não | Railway variable | JobWorker | ✅ OK | nenhuma | manter |
| Railway | production | `JOBS_DEFAULT_MAX_ATTEMPTS` | integer | presente no service | não | Railway variable | nenhum consumidor localizado no repositório atual | ⚠️ ATENÇÃO | variável órfã/stale provável | confirmar ausência de consumidor externo e remover do Railway |
| Railway | production | `OUTBOX_DISPATCH_BATCH_SIZE` | integer | presente; default `50` | não | Railway variable | Outbox dispatcher | ✅ OK | nenhuma | manter |
| Railway | production | `OUTBOX_DISPATCH_CLAIM_TTL_MS` | integer/ms | presente; default `60000` | não | Railway variable | Outbox dispatcher | ✅ OK | nenhuma | manter |
| Railway | production | `DLQ_RABBITMQ_DLX` | string | presente; default `moventra.dlx` | não | Railway variable | DLQ consumer | ✅ OK | nenhuma | manter |
| Railway | production | `DLQ_RABBITMQ_QUEUE` | string | presente; default `moventra.dlq.ingest` | não | Railway variable | DLQ consumer | ✅ OK | nenhuma | manter |
| Railway | production | `DLQ_RABBITMQ_PREFETCH` | integer | presente; default `10` | não | Railway variable | DLQ consumer | ✅ OK | nenhuma | manter |
| Railway | production | `DLQ_INGEST_PERSIST_RETRIES` | integer | presente; default `5` | não | Railway variable | DLQ consumer | ✅ OK | nenhuma | manter |
| Railway | production | `DLQ_INGEST_RETRY_BASE_MS` | integer/ms | presente; default `250` | não | Railway variable | DLQ consumer | ✅ OK | nenhuma | manter |
| Railway | production | `DLQ_INGEST_RETRY_MAX_MS` | integer/ms | presente; default `5000` | não | Railway variable | DLQ consumer | ✅ OK | nenhuma | manter |
| Railway | production | `RAILPACK_START_CMD` | platform/build config | presente | não | Railway | service startup | ✅ OK | não é contrato da aplicação | não incluir em `.env.example` |

## 7.2 Staging

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Railway | staging | `DATABASE_URL` | PostgreSQL connection string | presente nos dois services observados | sim | Railway | Workers Staging | ⚠️ ATENÇÃO | existem dois services de Worker | definir service canônico antes de remover legado |
| Railway | staging | `MESSAGING_RABBITMQ_URL` | AMQPS connection string | presente nos dois services observados | sim | Railway | Workers Staging | ⚠️ ATENÇÃO | topologia duplicada | consolidar após análise de dependências |
| Railway | staging-runtime | `MOVENTRA_RELEASE_SHA` | revision | presente | não | Railway | Worker staging runtime | ✅ OK | service mais novo possui identidade de revisão | preferir como canônico se confirmado |
| Railway | staging legado | `MOVENTRA_RELEASE_SHA` | revision | ausente | não | Railway | Worker antigo | ⚠️ ATENÇÃO | service antigo não cumpre contrato de revision identity | retirar service ou alinhar antes de uso |
| Railway | staging-runtime | variáveis DLQ | operacional | não observadas no inventário retornado | não | Railway | DLQ ingestion | ⚠️ ATENÇÃO | Production possui contrato DLQ mais completo | validar antes de declarar Fase 026 totalmente convergida |

---

# 8. Jobs e Transactional Outbox — defaults canônicos

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Worker | todos | `JOBS_BATCH_SIZE` | integer | `25` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_CONCURRENCY` | integer | `5` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_LEASE_MS` | integer/ms | `60000` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_HEARTBEAT_MS` | integer/ms | `20000` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_IDLE_POLL_MS` | integer/ms | `1000` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_IDLE_POLL_MAX_MS` | integer/ms | `5000` mínimo efetivo | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_HANDLER_TIMEOUT_MS` | integer/ms | `30000` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_RETRY_BASE_MS` | integer/ms | `1000` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `JOBS_RETRY_MAX_MS` | integer/ms | `300000` | não | `src/worker.js` | JobWorker | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `OUTBOX_DISPATCH_BATCH_SIZE` | integer | `50` | não | `src/worker.js` | Outbox Dispatcher | ✅ DEFAULT | nenhuma | manter |
| Worker | todos | `OUTBOX_DISPATCH_CLAIM_TTL_MS` | integer/ms | `60000` | não | `src/worker.js` | Outbox Dispatcher | ✅ DEFAULT | nenhuma | manter |

---

# 9. OpenTelemetry / Observabilidade

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Observability | todos | `OTEL_EXPORTER_OTLP_ENDPOINT` | URL/sensitive config | opcional; ausente => sem OTLP | depende | secret/config store | telemetry SDK | ❓ NÃO VERIFICADO externamente | valor runtime não auditado via conector | manter opcional e validar provider antes de habilitar |
| Observability | todos | `OTEL_EXPORTER_OTLP_HEADERS` | headers | opcional | sim quando contém credencial | secret store | OTLP exporters | ❓ NÃO VERIFICADO externamente | valor runtime não auditado via conector | nunca registrar em logs |
| Observability | todos | `OTEL_TRACES_EXPORTER` | enum/config | vazio/`otlp` + endpoint => `otlp`; `none` => off | não | runtime | trace exporter | ✅ contrato | faltava no `.env.example` | adicionado ao contrato |
| Observability | todos | `OTEL_METRICS_EXPORTER` | enum/config | vazio/`otlp` + endpoint => `otlp`; `none` => off | não | runtime | metric exporter | ✅ contrato | faltava no `.env.example` | adicionado ao contrato |
| Observability | todos | `OTEL_SDK_DISABLED` | boolean/string | `true` desabilita; ausente=false | não | runtime | telemetry SDK | ✅ contrato | faltava no `.env.example` | adicionado ao contrato |
| Observability | Worker | `MOVENTRA_RELEASE_SHA` | revision | prioridade máxima para Worker | não | Railway/release | resource `service.version` | ✅ após correção | telemetry anteriormente ignorava a variável enquanto logger já a usava | padronizar prioridade em logger e telemetry |
| Observability | Vercel | `APP_VERSION` | revision | SHA injetado no build imutável | não | build output | resource `service.version` | ✅ OK | nenhuma | manter fallback após `MOVENTRA_RELEASE_SHA` |
| Observability | Vercel | `VERCEL_GIT_COMMIT_SHA` | platform fallback | SHA quando disponível | não | Vercel | revision fallback | ✅ fallback | não é identidade canônica do prebuilt | manter apenas como fallback |

---

# 10. Variáveis automáticas de plataforma

Estas variáveis podem existir no processo, mas **não pertencem ao contrato de configuração manual da aplicação**.

| Sistema | Ambiente | Variável | Tipo | Valor/default | Secret | Origem | Consumidor | Status | Divergência | Ação |
|---|---|---|---|---|---:|---|---|---|---|---|
| Railway | service | `RAILWAY_ENVIRONMENT` | platform auto | gerado pela Railway | não | Railway | plataforma/runtime | ✅ AUTO | nenhuma | não adicionar ao `.env.example` |
| Railway | service | `RAILWAY_ENVIRONMENT_ID` | platform auto | gerado pela Railway | não | Railway | plataforma/runtime | ✅ AUTO | nenhuma | não adicionar ao `.env.example` |
| Railway | service | `RAILWAY_ENVIRONMENT_NAME` | platform auto | gerado pela Railway | não | Railway | plataforma/runtime | ✅ AUTO | nenhuma | não adicionar ao `.env.example` |
| Railway | service | `RAILWAY_PRIVATE_DOMAIN` | platform auto | gerado pela Railway | potencialmente sensível | Railway | networking | ✅ AUTO | nenhuma | não copiar para docs de valores |
| Railway | service | `RAILWAY_PROJECT_ID` | platform auto | gerado pela Railway | não | Railway | plataforma | ✅ AUTO | nenhuma | metadata apenas |
| Railway | service | `RAILWAY_PROJECT_NAME` | platform auto | gerado pela Railway | não | Railway | plataforma | ✅ AUTO | nenhuma | metadata apenas |
| Railway | service | `RAILWAY_SERVICE_ID` | platform auto | gerado pela Railway | não | Railway | plataforma | ✅ AUTO | nenhuma | metadata apenas |
| Railway | service | `RAILWAY_SERVICE_NAME` | platform auto | gerado pela Railway | não | Railway | plataforma | ✅ AUTO | nenhuma | metadata apenas |
| Vercel | runtime | `VERCEL_ENV` | platform auto | gerado pela Vercel | não | Vercel | environment fallback | ✅ AUTO | nenhuma | não substituir `MOVENTRA_ENV` canônico |
| Vercel | runtime | `VERCEL_TARGET_ENV` | platform auto | gerado pela Vercel | não | Vercel | environment fallback | ✅ AUTO | nenhuma | não substituir `MOVENTRA_ENV` canônico |
| Vercel | runtime | `VERCEL_GIT_COMMIT_SHA` | platform auto | gerado quando aplicável | não | Vercel | revision fallback | ✅ AUTO | prebuilt usa `APP_VERSION` | manter fallback apenas |
| GitHub | job | `GITHUB_*` | platform auto | gerado pelo Actions | varia | GitHub | workflows | ✅ AUTO | nenhuma | não persistir como config da aplicação |

---

# 11. Divergências e ações oficiais

| Prioridade | Divergência | Decisão canônica | Estado neste change |
|---|---|---|---|
| P1 | `MIGRATIONS_DATABASE_URL` usado pelos workflows, mas ausente do `.env.example` | nome canônico = `MIGRATIONS_DATABASE_URL` | corrigido |
| P1 | política mencionava nomenclatura de migration divergente | usar exclusivamente `MIGRATIONS_DATABASE_URL` | corrigido |
| P1 | OTEL `service.version` do Worker não priorizava `MOVENTRA_RELEASE_SHA` | prioridade: `MOVENTRA_RELEASE_SHA` → `APP_VERSION` → `VERCEL_GIT_COMMIT_SHA` → `development` | corrigido em código + teste |
| P1 | `MOVENTRA_AUTH_JWT_SUBJECT_CLAIMS` já era consumida/sincronizada, mas estava ausente do `.env.example` e da Matriz; o smoke local não propagava a ordem canônica | contrato canônico = `sub,id`; smoke deve usar a mesma ordem e fonte JWT determinística | corrigido no forward-fix do Release Gate #99 |
| P2 | `.env.example` documentava default `MESSAGING_PROVIDER=rabbitmq`, mas código default é `disabled` | default seguro = `disabled`; Staging/Production explicitam `rabbitmq` | corrigido |
| P2 | `VERCEL_STAGING_PROJECT_ID` ainda aparecia no contrato de env | Staging resolve projeto pelo nome canônico | removido do contrato ativo |
| P2 | `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_SDK_DISABLED` eram consumidos pelo código sem constar no template | declarar nomes no `.env.example`, sempre vazios | corrigido |
| P2 | `JOBS_DEFAULT_MAX_ATTEMPTS` existe no Railway, sem consumidor localizado | não tornar canônico enquanto não houver consumidor | pendente externo: remover após confirmação |
| P2 | dois Workers Staging observados | um único service deve ser declarado canônico | pendente externo: analisar dependências |
| Hardening | Neon `main`/Staging observadas sem proteção e acesso público sem allowlist | tratar em fase de hardening de infraestrutura | pendente externo |

## 12. Regra de manutenção

Toda alteração que introduzir, renomear ou remover variável deve atualizar na mesma mudança, quando aplicável:

1. código consumidor e validação/default;
2. `.env.example`;
3. esta Matriz Mestre;
4. `docs/security/SECRETS-POLICY.md` quando envolver material sensível;
5. workflows/release scripts;
6. testes anti-regressão;
7. stores externos de Staging/Production por fluxo governado.

Nenhuma variável encontrada apenas em um provider externo deve ser automaticamente promovida a contrato canônico. Primeiro deve existir consumidor explícito, owner, escopo, classificação de segurança e justificativa operacional.
