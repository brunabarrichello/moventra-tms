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
023 — Transactional Outbox = ACTIVE / DEFINED
024+ = NOT ACTIVE

P0 pós-G2 — Runtime PostgreSQL least privilege = CONCLUDED
P1 pós-G2 — Pipeline integrado + release impact = CONCLUDED

G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

A linha canônica e as regras de promoção estão em `docs/foundation/IMPLEMENTATION-ORDER.md`. As fases 018–023 estão documentadas em `docs/implementation/018-configuracoes.md`, `019-feature-flags.md`, `020-observabilidade-base.md`, `021-error-handling.md`, `022-idempotencia.md` e `023-outbox.md`.

## Fundação organizacional e de segurança

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
```

`identity.users`, `identity.external_identities`, `security.permissions` e catálogos globais de plataforma permanecem globais ao SaaS. Vínculos, regras e grants organizacionais são tenant-scoped quando pertencem a um Tenant. UUID vindo do cliente nunca é prova de autorização. Feature Flag nunca substitui autenticação, RBAC, escopo organizacional, RLS ou regra de negócio. Observabilidade não substitui Audit e deve respeitar minimização/LGPD. Error Handling não expõe stack, SQL, DSN, tokens, cookies ou identificadores cross-tenant não autorizados. Idempotência não significa exactly-once de efeitos externos; Transactional Outbox elimina a janela entre commit do negócio e intenção de publicação, sem substituir idempotência do consumidor.

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
```

Checksum funcional mais recente aplicado em Neon Staging e Main:

```text
0014_idempotency.sql = 5a1807d7b45ea49aae1e5da87e629ebedb5de7bd761620fc056d7c46ff86f41c
```

As fases 020 e 021 não criaram migrations PostgreSQL. A fase 022 criou o schema `idempotency` e `idempotency.records`, com RLS e runtime least privilege sem `DELETE`/DDL.

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

Revisão funcional/runtime e evidências oficiais:

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

A fase implementa `IdempotencyService`, fingerprint canônico/versionado, hash versionado da `Idempotency-Key`, stored result seguro, concorrência baseada em constraint/transação PostgreSQL, RLS tenant-aware, integração com Error Handling/Observabilidade e reutilização do pipeline autorizado. O runtime PostgreSQL de Production possui `USAGE` no schema e `SELECT/INSERT/UPDATE` em `idempotency.records`, sem `CREATE`, `DELETE` ou `BYPASSRLS`. Replay não duplica a mutação nem o Audit original.

O mesmo artefato imutável passou por Staging, rollback/restore e Production protegida. `/health` e `/api/database-health` retornaram 200 para a revisão `028c9844005ced58806201bce9edce37b4ba2a01`, com logs estruturados contendo request/correlation/trace context. A migration `0014` foi aplicada em Neon Main sob o gate aprovado e verificada com checksum canônico.

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

A fundação 001–017, os hardenings P0/P1 e as fases 018–022 estão concluídos. A próxima etapa oficial é **023 — Transactional Outbox = ACTIVE / DEFINED**, rastreada pela Issue #103. A fase 024 — Mensageria e todas as posteriores permanecem inativas até a conclusão formal da 023.