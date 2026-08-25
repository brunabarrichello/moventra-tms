# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial multi-tenant, multiempresa e multifilial, com monólito modular como arquitetura inicial, segurança por padrão, LGPD, observabilidade, idempotência, isolamento tenant-aware e autorização crítica no backend.

## Estado oficial

```text
001 — Governança = CONCLUDED
002 — Arquitetura Base = CONCLUDED
003 — Ambientes = CONCLUDED
004 — CI/CD = CONCLUDED
005 — Secrets Management = CONCLUDED
006 — Banco Base = CONCLUDED
007 — Convenções de Dados = CONCLUDED
008 — Tenant = CONCLUDED
009 — Empresa = CONCLUDED
010 — Filial = CONCLUDED
011 — Usuários = CONCLUDED
012 — Memberships = CONCLUDED
013 — Auth = CONCLUDED
014 — RBAC = CONCLUDED
015 — Escopo Organizacional = CONCLUDED
016 — RLS / Defesa adicional = CONCLUDED
017 — Auditoria Central = CONCLUDED
018 — Configurações = CONCLUDED
019 — Feature Flags = CONCLUDED
020 — Observabilidade Base = CONCLUDED
021 — Error Handling = CONCLUDED
022 — Idempotência = CONCLUDED
023 — Transactional Outbox = CONCLUDED
024 — Mensageria = ACTIVE / DEFINED
025+ = NOT ACTIVE

P0 pós-G2 — Runtime PostgreSQL least privilege = CONCLUDED
P1 pós-G2 — Pipeline integrado + release impact = CONCLUDED

G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

A linha canônica e as regras de promoção estão em `docs/foundation/IMPLEMENTATION-ORDER.md`. As fases 018–024 estão documentadas em `docs/implementation/018-configuracoes.md`, `019-feature-flags.md`, `020-observabilidade-base.md`, `021-error-handling.md`, `022-idempotencia.md`, `023-outbox.md` e `024-mensageria.md`.

## Fundação organizacional, segurança e confiabilidade

```text
Tenant
└── Empresa
    └── Filial

User = identidade global/provider-agnostic
ExternalIdentity = provider + issuer + subject → User
Membership = User ↔ Tenant
RBAC = Permissions + Roles + Grants
Organizational Scope = Tenant / Empresa / Filial
RLS = defesa adicional por Tenant transaction-local
Audit Trail = tenant-scoped + append-only + redaction/minimização
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = rollout determinístico + targeting tenant-aware
Observability = OpenTelemetry + structured logs + traces + metrics + request/correlation context
Error Handling = erros tipados + códigos estáveis + Problem Details + normalização segura
Idempotency = Idempotency-Key hash + request fingerprint + stored result transacional
Outbox = evento a publicar registrado atomicamente com a mutação de negócio
Messaging = portas provider-neutral + broker adapter, at-least-once, confirms e ack/nack
```

`identity.users`, `identity.external_identities`, `security.permissions` e catálogos globais de plataforma permanecem globais ao SaaS. Vínculos, regras e grants organizacionais são tenant-scoped quando pertencem a um Tenant. UUID vindo do cliente nunca é prova de autorização. Feature Flag nunca substitui autenticação, RBAC, escopo organizacional, RLS ou regra de negócio. Observabilidade não substitui Audit e deve respeitar minimização/LGPD. Error Handling não expõe stack, SQL, DSN, tokens, cookies ou identificadores cross-tenant não autorizados. Idempotência não significa exactly-once de efeitos externos; Transactional Outbox elimina a janela entre commit do negócio e intenção de publicação; Mensageria assume entrega at-least-once e consumers idempotentes.

## Banco e migrations vigentes

Provider oficial: Neon PostgreSQL 18.6.

```text
db/migrations/0001_foundation.sql
db/migrations/0002_tenant.sql
db/migrations/0003_company.sql
db/migrations/0004_branch.sql
db/migrations/0005_user.sql
db/migrations/0006_membership.sql
db/migrations/0007_external_identity.sql
db/migrations/0008_rbac.sql
db/migrations/0009_organizational_scope.sql
db/migrations/0010_rls.sql
db/migrations/0011_audit.sql
db/migrations/0012_configuration.sql
db/migrations/0013_feature_flags.sql
db/migrations/0014_idempotency.sql
db/migrations/0015_outbox.sql
```

As fases 020 e 021 não criaram migrations PostgreSQL. A fase 022 criou o schema `idempotency`; a fase 023 criou o schema `outbox` e `outbox.events`, ambos com isolamento tenant-aware e least privilege. A fase 024, por decisão inicial, não exige nova migration PostgreSQL: a intenção transacional continua em `outbox.events` e o broker fornece a fila externa.

## Fase 020 — Observabilidade Base

```text
revision                    = 256e87991d73cea1dd4a385488708409cb22b0b2
PR                          = #96
Issue                       = #95
Production Promotion        = 32876872400 = success
Production deployment       = dpl_2poo2Y8TnDaie3MM4NA2KzbXwBMu
Production state            = READY
Production approval         = approved / alexoaraujo83
prevent_self_review         = true
artifact_sha256             = a12994c179bde36eb5690c12a24b72fdcbf4ad92aa28f24ebffeb589132d6f91
```

## Fase 021 — Error Handling

```text
Issue                         = #98
PR técnica                    = #99
revision                      = e23cff77cd1af4b590fd3bf9ceac98e1cca4e5dc
Moventra CI (main)            = 32879964993 = success
Release Gate / Staging        = 32880111232 = success
Rollback Drill                = 32880277853 = success
Production Promotion          = 32880504603 = success
Production deployment         = dpl_8g1qdBw99RyZePkKJqm8CCCjGyJj
Production state              = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
artifact_sha256               = e352490006a3b4dbacb7aef758279e9cd00dd71bc9cb6c9650347d459cfc1106
```

## Fase 022 — Idempotência

```text
Issue                         = #101
PR técnica                    = #102
revision                      = 028c9844005ced58806201bce9edce37b4ba2a01
Foundation CI (PR)            = 32884603521 = success
Moventra CI (PR)              = 32884603500 = success
Moventra CI (main)            = 32885005759 = success
Release Gate / Staging        = 32885144772 = success
Rollback Drill                = 32885320734 = success
Production Promotion          = 32885547785 = success
Production deployment         = dpl_8cVxgkFEaaQHh5spQiomrPgt14aK
Production URL                = moventra-31craqkfb-alebru.vercel.app
Production state              = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = 495b6fc6cd29a558330bcc43bd4d8840cd9f4bd119728ca0850572ff94e3cbc8
production evidence artifact  = production-deployment-028c9844005ced58806201bce9edce37b4ba2a01
production evidence digest    = 497ed0c5b8904182c3f1b5d70a7f5a0ffd07b7603934d95b4819643e5172aeaa
migration                     = 0014_idempotency.sql
migration checksum            = 5a1807d7b45ea49aae1e5da87e629ebedb5de7bd761620fc056d7c46ff86f41c
```

## Fase 023 — Transactional Outbox

Revisão funcional/runtime e evidências oficiais:

```text
Issue                         = #103
PR técnica                    = #105
revision                      = b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
Foundation CI (main)          = 32890000608
Moventra CI (main)            = 32890000544 = success
Release Gate / Staging        = 32890129781 = success
Rollback Drill                = 32890282262 = success
Production Promotion          = 32890504200 = success
Production deployment URL     = moventra-arotbh5h6-alebru.vercel.app
Stable Production alias       = moventra-tms.vercel.app
Production state              = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = dbe15e5b394811e62e645aed1502159f8d1d9cd512c3f4de90c8c070b88cb9c6
production evidence artifact  = production-deployment-b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
production evidence digest    = 09bfbdd7cdcccd75b615a2c33cc609f00761eda303741d23991fc5d108530e2e
migration                     = 0015_outbox.sql
```

A fase 023 materializou `outbox.events` tenant-scoped com RLS, constraints, claim/reclaim concorrente baseado em `FOR UPDATE SKIP LOCKED`, runtime least privilege e integração transacional com mutação de negócio, Audit e Idempotência 022. Replay idempotente não duplica Outbox. O mesmo artefato imutável passou por Staging, rollback/restore e Production protegida; revision identity e `/api/database-health` foram validados no deployment imutável e no alias estável.

## Fase 024 — Mensageria

A fase 024 está `ACTIVE / DEFINED` na Issue #106. O documento canônico define portas provider-neutral e primeiro adapter de referência RabbitMQ/AMQP 0-9-1, com publisher confirms, mensagens persistentes, ack/nack manual, prefetch controlado, envelope versionado, observabilidade e semântica at-least-once. Jobs 025 e DLQ administrativa 026 permanecem fora do escopo.

A conclusão da 024 depende de broker RabbitMQ/serviço equivalente real, segregado por ambiente, com TLS e credenciais de menor privilégio. CI pode usar RabbitMQ efêmero, mas Staging/Production não podem usar fallback inseguro ou broker embutido.

## Runtime e entrega

Cadeia oficial para mudanças runtime-impacting:

```text
CI
→ immutable prebuilt artifact
→ staging
→ rollback/restore
→ protected production approval
→ same artifact
→ revision identity
→ database readiness
→ runtime observability
→ production evidence
```

Gates humanos protegidos não podem ser contornados por deploy manual. Revisões exclusivamente documentais percorrem a classificação auditável, mas não alteram runtime.

## Continuidade

A fundação 001–017, os hardenings P0/P1 e as fases 018–023 estão concluídos. A próxima etapa oficial é **024 — Mensageria = ACTIVE / DEFINED**, rastreada pela Issue #106. A fase 025 — Jobs e todas as posteriores permanecem inativas até a conclusão formal da 024.
