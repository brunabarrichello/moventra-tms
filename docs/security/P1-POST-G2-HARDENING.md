# P1 — Hardening pós-G2: pipeline de segurança e impacto de release

## Estado

`ACTIVE / IMPLEMENTED IN BRANCH / PRODUCTION NOT CHANGED`

Issue canônica: `#85`.

Este trabalho é **hardening/revalidação do G2**. Não cria uma nova fase funcional e **não ativa a fase 018**.

## Objetivos

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

O pipeline é implementado por `AuthorizedTenantOperationService` e deve reutilizar os componentes canônicos existentes. Nenhum domínio futuro deve duplicar Auth, Membership, RBAC, Scope, contexto de Tenant ou Audit.

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

## Comportamento dos workflows

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

Os workflows permanecem executáveis/auditáveis; apenas os jobs que mudam runtime são evitados.

Para commit `runtime-impacting`, a cadeia continua obrigatoriamente:

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

Nenhum bypass do environment protegido é autorizado.

## Critérios de conclusão

O P1 somente pode ser encerrado quando:

- CI unit/architecture/integration e PostgreSQL contract estiverem verdes;
- o pipeline integrado estiver comprovado com role non-owner/NOBYPASSRLS;
- uma revisão runtime-impacting percorrer Staging + rollback/restore;
- Production somente for promovida após gate humano explícito;
- a revisão Production tiver health/readiness e revision identity verificadas;
- o comportamento docs-only estiver comprovado sem novo deployment de aplicação;
- Issue #85 e Confluence forem sincronizados;
- fase 018 continuar `NOT ACTIVE` até a conclusão deste hardening.
