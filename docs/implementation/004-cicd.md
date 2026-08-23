# 004 — CI/CD

## Status

`CONCLUDED`

A fase 004 está formalmente concluída. A cadeia canônica de entrega build-once, artefato imutável, staging, rollback/restore, promoção protegida e produção foi executada com sucesso e possui evidência associada à revisão promovida.

## Objetivo

Estabelecer um pipeline automatizado, reproduzível, auditável e fail-closed para o Moventra TMS, preservando a identidade do mesmo artefato entre validação e produção.

## Invariante oficial de entrega

```text
source revision
→ lint / tests / security / build
→ immutable prebuilt artifact
→ staging
→ revision-aware smoke
→ rollback / restore drill
→ protected production preflight
→ human environment approval
→ same immutable artifact
→ production
→ revision identity
→ database readiness
→ production evidence
```

Nenhuma promoção oficial deve reconstruir o source entre staging e production.

## Evidência final canônica

Revisão promovida:

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

## Evidência de runtime production

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

Os registros históricos permanecem em:

- `docs/implementation/004-current-state-audit-2026-08-22.md`;
- `docs/implementation/004-production-promotion-remediation-2026-08-22.md`;
- `docs/implementation/004-rollback-drill.md`.

## Gate de conclusão

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
- [x] production evidence artifact emitido.

## Estado oficial

```text
004 = CONCLUDED
005 = CONCLUDED
```

A 004 não possui blocker aberto.