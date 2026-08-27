# 026 — DLQ — Final Evidence Closure

## Estado

`IMPLEMENTED IN SOURCE / AWAITING PR CI → MAIN CI → STAGING → ROLLBACK EVIDENCE`

Este checkpoint não conclui a fase 026, não fecha a Issue #115, não autoriza Production e não ativa a fase 027 — Object Storage.

## Objetivo

Fechar as três lacunas remanescentes de evidência da fase 026 sem alterar as garantias de segurança já aprovadas:

1. concorrência real de decisões/replay DLQ contra PostgreSQL;
2. smoke autenticado da Admin API em Staging atravessando JWT → ExternalIdentity → Membership → RBAC → Organizational Scope → RLS → Audit;
3. comprovação de que o runtime Vercel, e não apenas o runner de CI, possui configuração RabbitMQ válida e obtém publisher confirm durante reprocessamento governado.

## Concorrência PostgreSQL real

`scripts/db/validate-dlq-concurrency.mjs` usa duas sessões concorrentes e a role sintética não-owner `moventra_app_ci`.

O contrato prova dois casos:

- duas decisões terminais com a mesma versão disputam a mesma entrada; somente uma persiste e a concorrente stale não produz segunda mutação;
- duas tentativas de criar o Job filho para a mesma decisão DLQ convergem para exatamente um registro por `reprocessed_from_dlq_entry_id`; o segundo racer recupera o mesmo filho persistido.

A prova é executada por `scripts/ci/runtime-access-contract.sh` e pelo `Moventra DLQ Contract`.

## Admin API autenticada em Staging

`scripts/release/smoke-dlq-admin.mjs` cria uma identidade efêmera pelo Neon Auth de Staging, solicita um JWT JWKS-verificável e valida criptograficamente o token com o mesmo `BearerJwtAssertionVerifier` usado pelo runtime.

O principal Moventra de smoke é técnico e reutilizável no ambiente de Staging. Cada execução associa apenas a `ExternalIdentity` efêmera ao User técnico existente. A API então executa:

```text
GET /api/v1/dlq/entries
GET /api/v1/dlq/entries/{id}
POST /api/v1/dlq/entries/{id}/reprocess
POST /api/v1/dlq/entries/{id}/reprocess   # mesmo Idempotency-Key
```

Critérios do smoke:

- JWT real e assinatura válida via JWKS;
- Tenant explícito e RLS;
- Membership ACTIVE;
- RBAC `dlq.read` e `dlq.reprocess`;
- escopo organizacional TENANT;
- ETag/`If-Match`;
- `Idempotency-Key` primeiro `executed` e depois `replayed`;
- nenhuma duplicação de Audit SUCCESS no replay idempotente;
- entrada final `resolved` com `resolution_code=message_reprocessed`;
- `reprocess_count=1`.

JWT, cookie, senha, broker URL e demais credenciais não entram no artefato de evidência. Somente SHA-256 do subject autenticado é registrado para correlação técnica minimizada.

## RabbitMQ no runtime Vercel

`scripts/release/sync-messaging-env-to-vercel.sh` sincroniza, através do GitHub Environment protegido, o contrato de runtime:

```text
MESSAGING_PROVIDER=rabbitmq
MESSAGING_RABBITMQ_URL=<secret protegido>
MOVENTRA_ENV=staging|production
```

A URL do broker nunca é impressa. Antes do upsert, `resolveMessagingConfig()` valida o contrato e exige TLS em Staging/Production.

O smoke Admin reprocessa uma mensagem de fixture por meio do deployment Vercel exato. O sucesso exige `publisher confirm` retornado pelo adapter RabbitMQ do próprio runtime, comprovando que a configuração está efetivamente disponível dentro da função implantada.

## DLQ Contract final

`.github/workflows/dlq-contract.yml` passa a registrar `contract=final-evidence-closure` e exige sucesso simultâneo de:

```text
schema_0017_0020
durable_ingestion
message_reprocessing
job_reprocessing
admin_api_auth_rbac
postgresql_runtime_and_concurrency
dedicated_worker_runtime
```

O contrato não pode produzir evidência final verde se qualquer eixo falhar.

## Staging evidence

O `Moventra Release Gate` adiciona ao artefato `staging-deployment-<sha>`:

```text
messaging_url_synced=true
messaging_provider=rabbitmq
auth_provider_key=<provider público>
auth_algorithm=<algoritmo público>
auth_kid=<kid público>
auth_public_key_sha256=<hash público>
auth_smoke_subject_sha256=<hash minimizado>
dlq_admin_auth_e2e=success
dlq_tenant_rbac_rls=success
dlq_message_reprocess=success
vercel_runtime_messaging=success
dlq_http_idempotency=success
```

## Gate de conclusão

A sequência permanece obrigatoriamente:

```text
PR CI verde
→ merge protegido
→ main CI verde
→ Staging com final evidence closure verde
→ Rollback Drill verde
→ nova autorização humana explícita de Production
→ GitHub Environment review humano
→ Production evidence
→ reconciliação GitHub/Confluence
→ fechar Issue #115
→ 026 = EVIDENCED / CONCLUDED
→ ativar 027
```

Enquanto essa cadeia não estiver completa:

```text
026 = ACTIVE / NOT CONCLUDED
027 = NOT ACTIVE / BLOCKED
```
