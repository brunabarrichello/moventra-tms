# P1 — Hardening pós-G2: pipeline de segurança e impacto de release

## Estado

`CONCLUDED / VERIFIED IN PRODUCTION / DOCS-ONLY BEHAVIOR PROVEN`

Issue canônica: `#85`.

Este trabalho é **hardening/revalidação do G2**. Não cria uma nova fase funcional e, por si só, **não ativa a fase 018**. A ativação da 018 é uma transição de governança separada, executada somente após a conclusão formal deste P1.

## Objetivos concluídos

1. Transformar as primitives já implementadas nas fases 013–017 em um pipeline transacional reutilizável de aplicação.
2. Impedir que commits exclusivamente documentais provoquem deploy de aplicação, rollback drill ou gate de Production.

## Pipeline de segurança canônico

```text
verified provider assertion
→ ExternalIdentity ACTIVE
→ User ACTIVE
→ Membership ACTIVE no Tenant
→ RBAC permission
→ Organizational Scope
→ transaction-local Tenant context
→ RLS defense-in-depth
→ operação de domínio
→ Audit SUCCESS
→ COMMIT
```

O pipeline é implementado por `AuthorizedTenantOperationService` e reutiliza os componentes canônicos existentes. Nenhum domínio futuro deve duplicar Auth, Membership, RBAC, Scope, contexto de Tenant ou Audit.

### Boundary de autenticação

O serviço recebe somente `verifiedAssertion` produzido por um adapter de autenticação confiável. Headers HTTP arbitrários, UUIDs enviados pelo cliente ou claims ainda não verificados **não são prova de identidade**.

A integração com um provedor OIDC/JWT específico, login, sessão, refresh token e MFA continuam fora deste hardening.

### Atomicidade e conexão única

Toda decisão do caminho autorizado e a mutação correspondente usam a **mesma conexão PostgreSQL e a mesma transação** após a definição transaction-local de `moventra.tenant_id`.

Assim, Auth resolution, Membership, RBAC, Organizational Scope, RLS, mutação e Audit SUCCESS observam uma visão transacional coerente.

### Deny-by-default

A operação não é executada quando:

- ExternalIdentity, User ou Membership não estão operacionais;
- a permission não é concedida;
- o Organizational Scope não cobre o recurso solicitado;
- a RLS impede acesso ao Tenant/recurso.

Permission e Scope são verificações distintas. Uma role assignment sem scope aplicável não concede acesso organizacional.

### Auditoria

`SUCCESS` é appendado na mesma transação da operação, garantindo que mutação e evidência sejam confirmadas ou revertidas juntas.

`DENIED` e `FAILED` são appendados em uma nova transação tenant-scoped depois do rollback da tentativa principal. Falha na auditoria de fallback nunca pode substituir ou mascarar o erro original.

A auditoria continua sujeita às regras de minimização e redaction da fase 017.

## Validação PostgreSQL de integração

O CI executa `scripts/db/validate-security-pipeline.mjs` depois das migrations e validations SQL.

A validação utiliza uma role sintética `LOGIN / non-owner / NOBYPASSRLS`, criada pelo contrato de runtime P0, e comprova:

```text
Auth resolver real
+ Membership real
+ RBAC real
+ Organizational Scope real
+ SET LOCAL ROLE
+ moventra.tenant_id transaction-local
+ RLS cross-tenant
+ mutation permitida
+ Audit SUCCESS
+ RBAC DENIED
+ Scope DENIED
```

O banco de CI é descartável. Staging/Production não recebem dados sintéticos persistentes deste teste.

## Classificação de impacto de release

O script versionado `scripts/release/classify-release-impact.sh` classifica a diferença entre o commit candidato e seu pai imediato.

### Documentation-only

Somente alterações em caminhos explicitamente documentais podem ser classificadas como `documentation-only`, incluindo:

- `docs/**`;
- `README.md`;
- `LICENSE`;
- documentos Markdown de governança na raiz explicitamente permitidos.

Markdown localizado em diretório operacional fora de `docs/**` não é automaticamente isento.

### Runtime-impacting

Qualquer mudança fora da allowlist documental é fail-closed como `runtime-impacting`, inclusive:

- `src/**`, `api/**` e código;
- `db/**`;
- `scripts/**`;
- `.github/workflows/**`;
- package/lock/config;
- adição, modificação, rename ou deleção de artefato operacional.

`workflow_dispatch` continua sempre release-impacting.

## Comportamento dos workflows comprovado

Para commit `documentation-only`:

```text
Moventra CI
→ Release Gate: impact = documentation-only
→ Staging deployment = SKIPPED
→ Rollback Drill: impact = documentation-only
→ rollback/restore = SKIPPED
→ Production Promotion: impact = documentation-only
→ preflight = SKIPPED
→ protected production environment = NÃO solicitado
→ Vercel Production = NÃO alterada
```

Para commit `runtime-impacting`, a cadeia permanece obrigatoriamente:

```text
CI verde
→ immutable artifact
→ Staging
→ revision identity/readiness
→ rollback + restore
→ protected Production environment
→ aprovação humana externa
→ Production
```

Nenhum bypass do environment protegido é autorizado. O critério de fechamento exigia que **Production somente for promovida após gate humano explícito**; a evidência final comprova que essa condição foi respeitada.

## Evidência runtime-impacting em Production

```text
functional/runtime revision = 0a0ec943cc249e635d94267f386bb638228e11f7
PR                           = #86
Moventra CI                  = 32842532484
Release Gate                 = 32842647879
Rollback Drill               = 32842739426
Production Promotion         = 32842852069
Production deployment        = dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY
Production state             = READY
```

O environment protegido foi aprovado externamente, com `prevent_self_review=true`, por revisor diferente do ator do workflow. Revision identity, `/health`, `/api/database-health` e ausência de runtime errors foram validados.

## Prova real documentation-only

A PR #87 alterou somente `docs/security/P1-PRODUCTION-EVIDENCE.md` e foi incorporada à `main` em:

```text
docs-only revision = 4d96525ef825eda49fdb7c2199d3e5cc4e96102c
Moventra CI        = 32843990586 = success
Release Gate       = 32844092522 = success
Rollback Drill     = 32844107836 = success
Production Promo   = 32844120550 = success
```

Classificação observada:

```text
requires_release=false
classification=documentation-only
changed_file_count=1
runtime_file_count=0
documentation_file_count=1
```

Jobs de alteração de runtime:

```text
Staging prebuilt deployment                 = skipped
Provider-neutral prebuilt rollback drill    = skipped
Production fail-closed preflight            = skipped
Protected production deployment             = skipped
```

Após o merge documental, a Vercel registrou **zero novos deployments** tanto no projeto Staging quanto no projeto Production. O deployment Production funcional `dpl_3fJQRBCn7WKNtRwsKdVo7nsXmZbY` permaneceu `READY` e associado aos aliases estáveis.

## Resultado

Todos os critérios de conclusão do P1 foram atendidos:

- CI unit/architecture/integration e PostgreSQL contract verdes;
- pipeline integrado comprovado com role non-owner/NOBYPASSRLS;
- revisão runtime-impacting percorreu Staging + rollback/restore;
- Production promovida somente após gate humano explícito e aprovação externa efetiva;
- health/readiness e revision identity verificadas;
- comportamento docs-only comprovado sem novo deployment de aplicação;
- evidência versionada e pronta para sincronização de Issue/Confluence.

`P1 = CONCLUDED`.
