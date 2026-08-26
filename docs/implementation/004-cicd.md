# 004 — CI/CD

## Status

`CONCLUDED / HARDENED`

A fase 004 está formalmente concluída. A cadeia canônica de entrega build-once, artefato imutável, staging, rollback/restore, promoção protegida e produção foi executada com sucesso e possui evidência associada à revisão promovida.

Após a fase 026 / Batch 3, uma auditoria delta identificou dois gaps P1 de governança da cadeia: workflows downstream reclassificavam o diff em vez de herdar a intenção/evidência do upstream, e o release verificava database readiness sem promover migrations versionadas de ambiente. O hardening abaixo passa a integrar esses contratos à 004 sem reabrir a fase.

## Objetivo

Estabelecer um pipeline automatizado, reproduzível, auditável e fail-closed para o Moventra TMS, preservando a identidade do mesmo artefato entre validação e produção e a identidade do mesmo conjunto versionado de migrations entre Staging e Production.

## Invariante oficial de entrega

```text
source revision
→ lint / tests / security / build
→ immutable prebuilt artifact
→ Staging: promote exact revision migrations
→ same immutable artifact to Staging
→ revision-aware + database-aware smoke
→ rollback previous app revision against forward schema
→ restore current app revision
→ protected production preflight
→ human environment approval
→ Production: promote the exact migration set evidenced in Staging
→ same immutable artifact
→ production
→ revision identity
→ database readiness
→ production evidence
```

Nenhuma promoção oficial deve reconstruir o source entre Staging e Production. Nenhuma migration de Production pode ser promovida antes do environment protegido e da aprovação humana correspondente.

## Credenciais de banco

A cadeia separa explicitamente plano de dados e plano de controle:

- `DATABASE_URL`: credencial de runtime, de menor privilégio, sincronizada somente com o runtime correspondente;
- `MIGRATIONS_DATABASE_URL`: credencial protegida e dedicada à promoção de schema, disponível somente no GitHub Environment de Staging/Production e nunca sincronizada para Vercel, Railway ou aplicação.

O pipeline deve falhar fechado caso `MIGRATIONS_DATABASE_URL` não exista. O runner de migrations mapeia essa credencial para `DATABASE_URL` apenas no processo efêmero que executa `scripts/db/migrate.mjs`.

## Propagação de intenção e evidência

A semântica canônica passa a ser:

```text
Moventra CI workflow_dispatch
→ Release Gate = manual-release
→ staging-deployment-* evidence
→ Rollback Drill decide pelo artifact de evidence
→ rollback-drill-* evidence
→ Production Promotion decide pelo artifact de evidence
```

Workflows downstream não reclassificam novamente o diff do commit. A presença de uma única evidência upstream não expirada autoriza a continuação automática do gate; ausência de evidência representa `upstream-no-release-evidence`; múltiplas evidências conflitantes falham fechado.

## Promoção de migrations

`scripts/release/apply-database-migrations.sh` executa o runner versionado da revisão candidata, verifica novamente o status após a aplicação e emite:

```text
database_migration_max
database_migration_name
database_migration_checksum
```

Staging grava esses valores em `staging-deployment.txt`. O Rollback Drill preserva o mesmo conjunto de evidência e comprova que a revisão anterior da aplicação continua saudável contra o schema já promovido. Production somente aceita e aplica o conjunto de migrations cujo `max`, `name` e `checksum` coincidam com a evidência de Staging/rollback.

Essa estratégia implementa expand/backward-compatible deployment como gate operacional: rollback de aplicação não implica rollback destrutivo automático de schema.

## Evidência final canônica histórica

Revisão promovida na conclusão original da 004:

```text
517f44e788d0f74488ba54a09b44f18284d2b117
```

GitHub Actions:

- workflow: `Moventra Production Promotion`;
- run: `32662438316`;
- attempt final: `3`;
- conclusão: `success`;
- `Production fail-closed preflight`: `success`;
- `Protected production deployment`: `success`;
- checkout da revisão aprovada: `success`;
- captura da aprovação do environment: `success`;
- download e reverificação do artefato imutável: `success`;
- convergência do projeto Vercel production: `success`;
- deploy do mesmo artefato prebuilt: `success`;
- verificação de revision identity: `success`;
- `Verify production database readiness`: `success`;
- registro e upload da evidência de produção: `success`.

Artifact de evidência emitido:

```text
production-deployment-517f44e788d0f74488ba54a09b44f18284d2b117
sha256:a089d95d035830c997a0357139ce928ad4430db3f895f4770b00711b21bc6110
```

## Evidência de runtime production histórica

Projeto Vercel canônico:

```text
moventra-tms
prj_5qFenjyeGE1joaGomaNrUIRGSBQs
```

Deployment posterior à promoção protegida:

```text
dpl_BYNAb5FiqBeJkWeHATKZXCmfa7m4
state=READY
target=production
```

Alias estável validado:

```text
/health
HTTP 200
status=ok
version=517f44e788d0f74488ba54a09b44f18284d2b117

/api/database-health
HTTP 200
status=ready
version=517f44e788d0f74488ba54a09b44f18284d2b117
```

## Histórico de remediação

Execuções anteriores que falharam durante smoke, autorização Vercel ou readiness foram tratadas como evidência negativa válida e permaneceram fail-closed. As correções não relaxaram os gates: preservaram aprovação protegida, artefato imutável, identidade de revisão, Node 22.x e readiness PostgreSQL antes do encerramento da promoção.

Em 2026-08-26, após a promoção da fase 026 / Batch 3, a auditoria delta comprovou que Staging e Production podiam permanecer em migration anterior mesmo com deployment da aplicação concluído. A migration `0019` precisou ser aplicada sob gate explícito. Esse incidente operacional originou o hardening de promoção automática versionada de migrations e propagação por evidência upstream.

Os registros históricos permanecem em:

- `docs/implementation/004-current-state-audit-2026-08-22.md`;
- `docs/implementation/004-production-promotion-remediation-2026-08-22.md`;
- `docs/implementation/004-rollback-drill.md`.

## Gate de conclusão / hardening

- [x] lint e testes automatizados;
- [x] análise de segurança básica;
- [x] build reproduzível;
- [x] artefato prebuilt imutável;
- [x] staging revision-aware;
- [x] rollback/restore comprovado;
- [x] production fail-closed preflight;
- [x] approval do environment protegido;
- [x] deploy do exato artefato validado;
- [x] smoke e revision identity em production;
- [x] database readiness em production;
- [x] production evidence artifact emitido;
- [x] intenção manual propagada para o Release Gate;
- [x] downstream governado por evidência upstream;
- [x] promotion contract de migrations em Staging e Production definido;
- [x] rollback de aplicação validado contra forward schema;
- [x] separação `DATABASE_URL` × `MIGRATIONS_DATABASE_URL` definida.

## Estado oficial

```text
004 = CONCLUDED / HARDENED
005 = CONCLUDED
026 = ACTIVE / NOT CONCLUDED
027 = NOT ACTIVE
```

A 004 não possui blocker arquitetural aberto. A operacionalização de `MIGRATIONS_DATABASE_URL` nos environments protegidos é pré-condição para a próxima cadeia de release que contenha migrations.