# 022 — Idempotência

## Estado

`CONCLUDED`

A fase 022 foi implementada, validada em PostgreSQL real, promovida pela cadeia oficial de Staging → rollback/restore → Production protegida e concluída com evidência de runtime e banco. A fase 023 — Transactional Outbox é a próxima etapa oficial e passa a `ACTIVE / DEFINED`.

## Objetivo concluído

A fase estabeleceu um contrato transversal de idempotência para operações sensíveis do Moventra TMS:

```text
Idempotency-Key
+
Request Fingerprint
+
Stored Result
```

Quando o efeito de negócio estiver no PostgreSQL, o contrato oficial permanece:

```text
claim da chave
+
mutação de negócio
+
Audit de negócio
+
stored result
= mesma transação PostgreSQL / mesmo Tenant-RLS context
```

Essa garantia evita duplicação de efeitos transacionais em retry. Ela não promete exactly-once para efeitos externos fora do PostgreSQL; essa lacuna é tratada a partir da fase 023 — Transactional Outbox.

## Implementação materializada

### Banco

```text
schema                         = idempotency
tabela                         = idempotency.records
migration                      = db/migrations/0014_idempotency.sql
validation                     = db/validation/0014_idempotency_validation.sql
migration checksum             = 5a1807d7b45ea49aae1e5da87e629ebedb5de7bd761620fc056d7c46ff86f41c
```

Chave natural:

```text
(tenant_id, operation_key, key_hash)
```

Estados persistidos:

```text
PROCESSING
COMPLETED
```

O registro persiste somente hash SHA-256 versionado da `Idempotency-Key`, fingerprint canônico/versionado, stored result minimizado e `expires_at`. A chave em plaintext, payload bruto, tokens, cookies e material sensível não são persistidos no contrato de idempotência.

### Código

```text
src/modules/idempotency/fingerprint.js
src/modules/idempotency/idempotency-repository.js
src/modules/idempotency/idempotency-service.js
```

A implementação integra-se a:

```text
Auth / Membership / RBAC / Organizational Scope
Tenant transaction + RLS
Error Handling 021
Observabilidade 020
Audit 017
AuthorizedTenantOperationService
```

## Regras de negócio consolidadas

- primeira execução efetiva cria o claim, executa a mutação, registra o Audit de negócio e conclui o stored result na mesma transação;
- replay com mesma chave e mesmo fingerprint retorna o resultado armazenado sem nova mutação e sem duplicar o Audit original;
- mesma chave com fingerprint diferente resulta em conflito seguro `IDEMPOTENCY.REQUEST_MISMATCH`;
- rollback da operação remove o claim transacional e permite retry limpo;
- a chave externa nunca determina Tenant;
- RLS bloqueia leitura/escrita cross-tenant;
- concorrência é resolvida por constraint/transaction PostgreSQL, não por mutex local;
- expiração é metadata de retenção; cleanup físico permanece reservado ao framework de Jobs 025;
- runtime principal não possui `DELETE` ou DDL no schema/tabela de idempotência.

## Segurança e LGPD

Production foi verificada com:

```text
moventra_runtime_production:
  USAGE schema idempotency = true
  CREATE schema             = false
  SELECT records            = true
  INSERT records            = true
  UPDATE records            = true
  DELETE records            = false
  BYPASSRLS                  = false

moventra_app_production inherits moventra_runtime_production = true
RLS em idempotency.records = enabled
```

Observabilidade não registra `Idempotency-Key`, `key_hash`, `fingerprint` ou payload bruto como labels de alta cardinalidade.

## Evidência de CI e release

```text
Issue                         = #101
PR técnica                    = #102
functional/runtime revision   = 028c9844005ced58806201bce9edce37b4ba2a01
Foundation CI (PR)            = 32884603521 = success
Moventra CI (PR)              = 32884603500 = success
Moventra CI (main)            = 32885005759 = success
Release Gate / Staging        = 32885144772 = success
Rollback Drill                = 32885320734 = success
Production Promotion          = 32885547785 = success
Production deployment         = dpl_8cVxgkFEaaQHh5spQiomrPgt14aK
Production deployment URL     = moventra-31craqkfb-alebru.vercel.app
Production state              = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = 495b6fc6cd29a558330bcc43bd4d8840cd9f4bd119728ca0850572ff94e3cbc8
production evidence artifact  = production-deployment-028c9844005ced58806201bce9edce37b4ba2a01
production evidence digest    = 497ed0c5b8904182c3f1b5d70a7f5a0ffd07b7603934d95b4819643e5172aeaa
```

O artefato imutável exato foi promovido após rollback/restore comprovado. `/health` e `/api/database-health` retornaram 200 no deployment imutável e no alias estável. Logs de Production confirmaram `serviceVersion=028c9844005ced58806201bce9edce37b4ba2a01`, ambiente `production`, request/correlation IDs e trace/span IDs.

A migration `0014_idempotency.sql` foi aplicada em Neon Main sob o gate de Production aprovado, registrada em `moventra_meta.schema_migrations` com o checksum canônico e validada quanto a RLS e least privilege.

## Critérios de aceite finais

- [x] migration aditiva e versionada;
- [x] validation correspondente;
- [x] modelo tenant-scoped com RLS e constraints;
- [x] fingerprint e key hash versionados;
- [x] `IdempotencyService` reutilizável;
- [x] mesma transação para claim + efeito PostgreSQL + stored result;
- [x] replay sem duplicar mutação ou Audit;
- [x] mismatch seguro integrado a Problem Details;
- [x] concorrência real PostgreSQL comprovada;
- [x] rollback/retry comprovados;
- [x] runtime least privilege validado;
- [x] observabilidade de baixa cardinalidade;
- [x] nenhuma antecipação de Outbox/Mensageria/Jobs;
- [x] CI completo verde;
- [x] Neon Staging e Main validados;
- [x] Staging validado;
- [x] rollback/restore comprovado;
- [x] Production protegida aprovada e evidenciada.

## Próxima etapa

`023 — Transactional Outbox = ACTIVE / DEFINED`

Documento: `docs/implementation/023-outbox.md`  
Issue: `#103`

A fase 024 — Mensageria e todas as posteriores permanecem `NOT ACTIVE` até a conclusão formal da 023.