# Continuidade da Fundação — Linha Oficial de Implantação

A linha oficial do Moventra TMS preserva a sequência canônica de implantação. Neste checkpoint, a fundação e segurança 001–017, os hardenings P0/P1 e as fases 018–023 estão concluídos; a fase 024 — Mensageria é a única etapa funcional ativa.

Sequência atual:

**Governança → Arquitetura → Ambientes → CI/CD → Secrets → Banco base → Convenções → Tenant → Empresa → Filial → Usuários → Memberships → Auth → RBAC → Escopo Organizacional → RLS/Defesa adicional → Auditoria → Configurações → Feature Flags → Observabilidade → Error Handling → Idempotência → Outbox → Mensageria → Jobs → DLQ → Object Storage → demais domínios TMS**

## Semântica de estado

- **DEFINED** — arquitetura, responsabilidade e critérios documentados;
- **ACTIVE** — etapa oficialmente autorizada para execução;
- **PREPARED** — artefato técnico existe, mas a etapa ainda não está concluída;
- **IMPLEMENTED** — código ou infraestrutura existem fisicamente;
- **EVIDENCED** — execução real foi observada e validada;
- **CONCLUDED** — implementação, validação, evidência e governança do gate foram aprovadas.

## Estado canônico

| Etapa | Estado oficial | Evidência / decisão vigente |
|---|---|---|
| 001 — Governança | **CONCLUDED** | governança e processo versionados |
| 002 — Arquitetura Base | **CONCLUDED** | monólito modular vigente |
| 003 — Ambientes | **CONCLUDED** | ambientes segregados |
| 004 — CI/CD | **CONCLUDED** | build-once, immutable artifact, staging, rollback/restore e Production protegida |
| 005 — Secrets Management | **CONCLUDED** | stores segregados e least privilege |
| 006 — Banco Base | **CONCLUDED** | PostgreSQL/Neon 18.6 e migration framework |
| 007 — Convenções de Dados | **CONCLUDED** | contrato canônico e guardrails |
| 008 — Tenant | **CONCLUDED** | raiz SaaS materializada |
| 009 — Empresa | **CONCLUDED** | organização tenant-aware materializada |
| 010 — Filial | **CONCLUDED** | unidade tenant/company-aware materializada |
| 011 — Usuários | **CONCLUDED** | identidade global/provider-agnostic |
| 012 — Memberships | **CONCLUDED** | vínculo User ↔ Tenant materializado |
| 013 — Auth | **CONCLUDED** | ExternalIdentity provider-agnostic e resolução de identidade |
| 014 — RBAC | **CONCLUDED** | permissions globais, roles/grants tenant-scoped e deny-by-default |
| 015 — Escopo Organizacional | **CONCLUDED** | scopes Tenant/Empresa/Filial e assignments tenant-aware |
| 016 — RLS / Defesa adicional | **CONCLUDED** | contexto transaction-local e RLS tenant-aware |
| 017 — Auditoria Central | **CONCLUDED** | audit trail append-only, tenant-scoped e redigido |
| 018 — Configurações | **CONCLUDED** | catálogo tipado + overrides Tenant/Empresa/Filial + histórico + RLS/RBAC/Audit evidenciados em Production |
| 019 — Feature Flags | **CONCLUDED** | rollout determinístico e tenant-aware evidenciado em Production, sem substituir autorização |
| 020 — Observabilidade Base | **CONCLUDED** | OpenTelemetry vendor-neutral, logs estruturados, traces, métricas, correlation IDs, cardinalidade controlada e fail-safe evidenciados em Production |
| 021 — Error Handling | **CONCLUDED** | erros tipados, códigos estáveis, Problem Details, sanitização, anti-enumeração e retry classification evidenciados em Production |
| 022 — Idempotência | **CONCLUDED** | chave/fingerprint/stored result tenant-aware, transação PostgreSQL, RLS, concorrência e replay evidenciados em Production |
| 023 — Transactional Outbox | **CONCLUDED** | estado de negócio + Audit + outbox event na mesma transação, RLS, claim concorrente e replay idempotente evidenciados em Production |
| 024 — Mensageria | **ACTIVE / DEFINED** | RabbitMQ/serviço equivalente atrás de portas provider-neutral; at-least-once, confirms e ack/nack |
| 025+ | **NOT ACTIVE** | preservar ordem oficial |

## Gates macro

```text
G1 — Foundation Ready = APPROVED
G2 — Security Ready = APPROVED / REVALIDATED AFTER P0 + P1
```

G2 permanece aprovado. A fase 024 deve reutilizar os contratos consolidados de Auth, Membership, RBAC, Organizational Scope, RLS, Audit, Observability, Error Handling, Idempotência e Transactional Outbox. Mensageria não substitui autorização, não altera a origem confiável do Tenant e não cria exactly-once fim a fim.

## Revisões de segurança pós-G2

```text
P0 runtime least privilege revision = 8c17e8c2c101c6e5c3bda3c5870e86a9136d43a8
P1 functional/runtime revision      = 0a0ec943cc249e635d94267f386bb638228e11f7
P1 Production deployment            = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
P1 docs-only proof revision         = 4d96525ef825eda49fdb7c2199d3e5cc4e96102c
```

## Fase 020 — revisão funcional e release

```text
Issue                         = #95
PR técnica                    = #96
functional/runtime revision   = 256e87991d73cea1dd4a385488708409cb22b0b2
Production Promotion          = 32876872400 = success
Production deployment         = dpl_2poo2Y8TnDaie3MM4NA2KzbXwBMu = READY
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
```

## Fase 021 — revisão funcional e release

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
```

## Fase 022 — revisão funcional e release

```text
Issue                         = #101
PR técnica                    = #102
functional/runtime revision   = 028c9844005ced58806201bce9edce37b4ba2a01
Foundation CI (PR)            = 32884603521 = success
Moventra CI (PR)              = 32884603500 = success
source CI run                 = 32885005759 = success
Release Gate / Staging        = 32885144772 = success
Rollback Drill                = 32885320734 = success
Production Promotion          = 32885547785 = success
Production deployment         = dpl_8cVxgkFEaaQHh5spQiomrPgt14aK = READY
Production deployment URL     = moventra-31craqkfb-alebru.vercel.app
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = 495b6fc6cd29a558330bcc43bd4d8840cd9f4bd119728ca0850572ff94e3cbc8
production evidence artifact  = production-deployment-028c9844005ced58806201bce9edce37b4ba2a01
production evidence digest    = 497ed0c5b8904182c3f1b5d70a7f5a0ffd07b7603934d95b4819643e5172aeaa
```

## Fase 023 — revisão funcional e release

```text
Issue                         = #103
PR técnica                    = #105
functional/runtime revision   = b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
Foundation CI (main)          = 32890000608
source CI run                 = 32890000544 = success
Release Gate / Staging        = 32890129781 = success
Rollback Drill                = 32890282262 = success
Production Promotion          = 32890504200 = success
Production deployment URL     = moventra-arotbh5h6-alebru.vercel.app
Stable Production alias       = moventra-tms.vercel.app
Production approval           = approved / alexoaraujo83
prevent_self_review           = true
required_reviewer_count       = 2
artifact_sha256               = dbe15e5b394811e62e645aed1502159f8d1d9cd512c3f4de90c8c070b88cb9c6
production evidence artifact  = production-deployment-b585df5f9b544f7ed315d1fa3c081dda8c4d0a09
production evidence digest    = 09bfbdd7cdcccd75b615a2c33cc609f00761eda303741d23991fc5d108530e2e
migration                     = 0015_outbox.sql
```

A revisão 023 passou pela cadeia completa build-once → Staging → rollback/restore → Production protegida. A aprovação efetiva foi externa ao ator do workflow. Revision identity e database readiness passaram no deployment imutável e no alias estável. O `outbox.events` permanece provider-neutral e a publicação externa não ocorre dentro da transação PostgreSQL.

## Banco — estado canônico após 023

Provider: Neon PostgreSQL 18.6.

```text
0001_foundation.sql              = present
0002_tenant.sql                  = present
0003_company.sql                 = present
0004_branch.sql                  = present
0005_user.sql                    = present
0006_membership.sql              = present
0007_external_identity.sql       = present
0008_rbac.sql                    = present
0009_organizational_scope.sql    = present
0010_rls.sql                     = present
0011_audit.sql                   = present
0012_configuration.sql           = present
0013_feature_flags.sql           = present
0014_idempotency.sql             = present
0015_outbox.sql                  = present
```

Neon:

```text
staging = br-rapid-math-au6j6xut
main    = br-morning-glitter-au97suq4
```

`idempotency.records` e `outbox.events` são tenant-scoped e protegidos por RLS. O runtime segue non-owner/NOBYPASSRLS. Para Outbox, o runtime possui somente os privilégios necessários a leitura, append e atualização das colunas operacionais de claim/publicação, sem `DELETE` ou DDL.

## Boundary consolidado

```text
User = identidade global
ExternalIdentity = identidade técnica global de provider
Membership = vínculo User ↔ Tenant
RBAC = permission catalog global + grants tenant-scoped
Organizational Scope = Tenant / Company / Branch
RLS = defesa adicional baseada em contexto transacional autorizado
Audit Trail = tenant-scoped, append-only, minimizado e redigido
Configuration = catálogo tipado + overrides hierárquicos
Feature Flags = targeting tenant-aware com coorte determinística
Observability = OpenTelemetry + structured logging + tracing + metrics
Error Handling = taxonomia tipada + códigos estáveis + Problem Details
Idempotency = claim/fingerprint/stored result transacional e tenant-aware
Transactional Outbox = registro atômico da intenção de publicação, sem broker específico
Messaging = porta provider-neutral para broker, entrega at-least-once, confirms e ack/nack
```

## Regras específicas da fase 024

A implementação de referência será RabbitMQ/AMQP 0-9-1, isolada atrás de ports internos. Domínios não podem importar SDK/provider. Publisher confirms, mensagens persistentes, manual ack/nack, prefetch, envelope versionado, retry classification e observabilidade de baixa cardinalidade são obrigatórios.

A fase 025 — Jobs permanece fora do escopo: não criar scheduler, loop recorrente de dispatcher ou framework central de jobs. A fase 026 — DLQ permanece fora do escopo administrativo: topology técnica de dead-letter pode ser suportada, mas reprocessamento, UI e governança operacional pertencem à 026.

A conclusão `EVIDENCED / CONCLUDED` da 024 exige broker RabbitMQ/serviço equivalente real, segregado por ambiente, acessível por Staging e Production com TLS e credenciais de menor privilégio. Broker efêmero é aceitável apenas para CI.

## Regra de revision identity

A revisão funcional/runtime que conclui uma fase é registrada separadamente de revisões exclusivamente documentais. Commits documentais posteriores não reabrem o gate funcional nem exigem nova promoção de aplicação Production.

## Próxima transição oficial

A fase **023 — Transactional Outbox = CONCLUDED**. A fase **024 — Mensageria = ACTIVE / DEFINED**, conforme `docs/implementation/024-mensageria.md` e Issue #106. A fase 025 — Jobs e todas as posteriores permanecem inativas até a conclusão formal da 024.
