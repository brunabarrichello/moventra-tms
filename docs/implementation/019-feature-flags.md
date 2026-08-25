# 019 — Feature Flags

## Estado

`CONCLUDED`

A fase 019 foi concluída com implementação, validação PostgreSQL real, Staging, rollback/restore, aprovação humana externa de Production, promoção do artefato imutável, migration em Neon Main e evidência operacional. A fase 020 — Observabilidade Base está oficialmente `ACTIVE / DEFINED`.

## Objetivo

Criar uma plataforma empresarial de **Feature Flags** para rollout controlado de funcionalidades do Moventra TMS por:

```text
ambiente
tenant
plano
empresa
filial
usuário
percentual
```

Feature flag controla **exposição e rollout** de comportamento. Ela **nunca substitui autenticação, RBAC, Organizational Scope, RLS ou regra de negócio**.

## Decisão arquitetural

Feature Flags será um módulo próprio, separado de `configuration.*`.

Motivo:

- Configurações representam parâmetros operacionais/de negócio com resolução hierárquica e valor tipado;
- Feature Flags representam decisão booleana de exposição/rollout, com targeting, ambiente, coortes determinísticas e kill-switch;
- misturar os dois domínios criaria regras ambíguas, cache/invalidação inadequados e risco de usar configuração como autorização.

O módulo seguirá o monólito modular vigente e reutilizará Auth, Membership, RBAC, Organizational Scope, RLS, Audit e runtime least privilege.

## Modelo de avaliação

A avaliação é deny-safe do ponto de vista de rollout: ausência de definição ativa ou erro de avaliação deve resultar em erro explícito ou no fallback seguro definido pelo contrato do chamador; nunca em habilitação acidental.

Para uma flag `ACTIVE`, a decisão segue esta ordem:

```text
1. ambiente permitido / política global do ambiente
2. regra USER
3. regra BRANCH
4. regra COMPANY
5. regra TENANT
6. regra PLAN
7. política global do ambiente
8. default da flag
```

A regra mais específica encontrada vence. `PLAN` é menos específico que `TENANT`, permitindo que um Tenant sobrescreva o comportamento do plano ao qual pertence.

Uma regra vencedora pode possuir rollout percentual. `enabled=false` desabilita imediatamente. `enabled=true` com percentual inferior a 100% habilita apenas para a coorte determinística correspondente.

## Percentual determinístico

Percentual nunca será calculado por `random()` a cada request.

Representação:

```text
rollout_basis_points INTEGER
0     = 0.00%
5000  = 50.00%
10000 = 100.00%
```

Bucket canônico:

```text
bucket = stable_hash(flag_key + ':' + bucket_subject) mod 10000
enabled_for_subject = bucket < rollout_basis_points
```

`bucket_subject`:

```text
userId, quando houver principal autenticado
senão tenantId, para fluxos tenant-scoped sem User
```

A função de hash precisa ser estável entre processos, releases e ambientes equivalentes. Mudança do algoritmo exige versionamento explícito; não pode redistribuir coortes silenciosamente.

## Ambiente

O ambiente de execução é contexto confiável do servidor e **não pode ser aceito diretamente de query/body/header do cliente como autoridade**.

Ambientes iniciais reconhecidos:

```text
development
preview
staging
production
```

O catálogo global pode definir política por ambiente. Regras tenant-scoped também podem ser limitadas a um ambiente para permitir rollout progressivo sem duplicar flags.

## Plano

O domínio completo de Billing/Planos ainda não está ativo. Portanto, a fase 019 **não cria tabelas de billing nem FK para um plano inexistente**.

Targeting por plano será suportado por `plan_key` canônica no contrato de regra, avaliada somente quando o `planKey` vier de um **trusted plan context/provider interno**. Valor de plano vindo diretamente do cliente não é confiável.

Quando Billing SaaS/Planos for materializado na fase oficial futura, uma migration expand/contract poderá substituir/fortalecer `plan_key` com referência ao agregado canônico sem quebrar o contrato da 019.

## Modelo relacional alvo

Schema:

```text
feature_flags
```

### `feature_flags.flags`

Catálogo global de flags, governado pela plataforma, sem `tenant_id`.

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
key TEXT NOT NULL UNIQUE
name TEXT NOT NULL
description TEXT NULL
default_enabled BOOLEAN NOT NULL
status TEXT NOT NULL
hash_version SMALLINT NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version BIGINT NOT NULL
```

Regras:

- `key` lowercase, dot-separated e estável;
- lifecycle `ACTIVE` / `INACTIVE`;
- `hash_version` explicita o algoritmo de bucket;
- catálogo não é CRUD arbitrário de usuários tenant-scoped;
- nenhuma flag deve conter secret ou PII.

### `feature_flags.environment_policies`

Política global da flag por ambiente, governada pela plataforma.

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
flag_id UUID NOT NULL
environment TEXT NOT NULL
enabled BOOLEAN NOT NULL
rollout_basis_points INTEGER NOT NULL
status TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version BIGINT NOT NULL
UNIQUE (flag_id, environment)
```

Não possui `tenant_id`. É política global de release e não configuração de cliente.

### `feature_flags.rules`

Regra tenant-scoped de targeting.

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
tenant_id UUID NOT NULL
flag_id UUID NOT NULL
environment TEXT NULL
target_type TEXT NOT NULL
company_id UUID NULL
branch_id UUID NULL
user_id UUID NULL
plan_key TEXT NULL
enabled BOOLEAN NOT NULL
rollout_basis_points INTEGER NOT NULL
status TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version BIGINT NOT NULL
```

Candidate key:

```text
UNIQUE (tenant_id, id)
```

Targets:

```text
TENANT
COMPANY
BRANCH
USER
PLAN
```

Shape obrigatório:

```text
TENANT  => company_id/user_id/plan_key/branch_id NULL
COMPANY => company_id NOT NULL; branch_id/user_id/plan_key NULL
BRANCH  => company_id + branch_id NOT NULL; user_id/plan_key NULL
USER    => user_id NOT NULL; company_id/branch_id/plan_key NULL
PLAN    => plan_key NOT NULL; company_id/branch_id/user_id NULL
```

FKs:

```text
tenant_id → organization.tenants
(tenant_id, company_id) → organization.companies
(tenant_id, company_id, branch_id) → organization.branches
(tenant_id, user_id) → identity.memberships(tenant_id, user_id)
flag_id → feature_flags.flags
```

A FK de USER deve comprovar vínculo do User ao Tenant, sem adicionar `tenant_id` em `identity.users`.

Unicidade operacional deve impedir duas regras `ACTIVE` ambíguas para a mesma flag + ambiente + target dentro do Tenant. Índices parciais separados por `target_type` são preferíveis a uma unique genérica com vários NULLs.

### `feature_flags.rule_versions`

Histórico append-only de mudanças de regra.

Campos mínimos:

```text
id UUID PK DEFAULT uuidv7()
tenant_id UUID NOT NULL
rule_id UUID NOT NULL
rule_version BIGINT NOT NULL
enabled BOOLEAN NOT NULL
rollout_basis_points INTEGER NOT NULL
status TEXT NOT NULL
change_type TEXT NOT NULL
reason TEXT NULL
occurred_at TIMESTAMPTZ NOT NULL
UNIQUE (tenant_id, rule_id, rule_version)
```

Regras:

- append-only;
- UPDATE/DELETE bloqueados no banco;
- FK `(tenant_id, rule_id)` para `feature_flags.rules`;
- complementa o Audit central;
- não duplica dados de targeting imutáveis sem necessidade.

## Lifecycle

### Flag

```text
ACTIVE ⇄ INACTIVE
```

Flag `INACTIVE` não é habilitada por regras tenant-scoped.

### Environment Policy / Rule

```text
ACTIVE ⇄ INACTIVE
```

Sem hard delete operacional. Inativação preserva histórico e Audit.

## Regras de negócio

- flag inexistente/inativa nunca é habilitada silenciosamente;
- regra de Tenant só pode referenciar Tenant existente;
- Company/Branch devem pertencer ao mesmo Tenant;
- User target deve possuir Membership no Tenant;
- `plan_key` é apenas contexto confiável interno e não cria dependência antecipada de Billing;
- ambiente vem do runtime confiável;
- percentual é inteiro em basis points, `0..10000`;
- bucket é determinístico e versionado;
- USER > BRANCH > COMPANY > TENANT > PLAN > ambiente > default;
- regra mais específica desabilitando a flag deve vencer uma regra menos específica habilitando-a;
- optimistic locking obrigatório em alterações;
- cada alteração gera `rule_versions` e Audit na mesma transação autorizada;
- DENIED/FAILED seguem o pipeline P1;
- flag não concede permission, membership ou scope;
- endpoint protegido continua exigindo sua autorização normal mesmo quando a flag está habilitada;
- nenhum valor sensível, token ou secret pode ser armazenado em flags/rules.

## RBAC e Organizational Scope

Permissões administrativas iniciais:

```text
feature_flags.rules.read
feature_flags.rules.manage
```

A avaliação interna da flag não é uma autorização e não deve ser confundida com `feature_flags.rules.read`.

Administração de regras:

```text
TENANT rule  → coverage Tenant
COMPANY rule → coverage Company
BRANCH rule  → coverage Branch
USER rule    → coverage Tenant + vínculo User/Membership
PLAN rule    → coverage Tenant; planKey resolvida por provider confiável
```

Alterar o catálogo global `feature_flags.flags` ou políticas globais de ambiente não faz parte de uma permissão tenant-scoped comum; isso é operação de plataforma.

## RLS

Recebem RLS tenant-aware:

```text
feature_flags.rules
feature_flags.rule_versions
```

Usar `security.current_tenant_id()`.

Permanecem globais, sem RLS tenant-based:

```text
feature_flags.flags
feature_flags.environment_policies
```

## Runtime PostgreSQL

`db/runtime/runtime-access.sql` foi atualizado preservando least privilege.

Contrato comprovado:

```text
schema feature_flags: USAGE, sem CREATE
flags/environment_policies: SELECT somente
rules: SELECT/INSERT/UPDATE, sem DELETE
rule_versions: SELECT/INSERT, sem UPDATE/DELETE
```

Principal da aplicação continua non-owner/NOBYPASSRLS.

## Auditoria

Eventos mínimos:

```text
feature_flag.rule.created
feature_flag.rule.updated
feature_flag.rule.activated
feature_flag.rule.inactivated
feature_flag.rule.restored
feature_flag.evaluation.failed
```

Avaliações normais de alta frequência não devem gerar uma linha de Audit por request. Devem produzir métricas/logs agregáveis com cardinalidade controlada. Mudanças administrativas são auditadas integralmente.

Metadados permitidos incluem flag key, target type, ambiente, source, version e outcome; nunca token, secret ou PII desnecessária.

## API alvo

### Avaliar flag

```text
GET /api/v1/feature-flags/{key}/evaluation
```

Contexto de `tenantId`, `userId`, `companyId`, `branchId`, `planKey` deve ser derivado do principal/contexto autorizado e de providers internos, não confiado a valores arbitrários do cliente.

Resposta conceitual:

```json
{
  "key": "operations.trips.new-dispatch",
  "enabled": true,
  "source": "BRANCH",
  "ruleId": "...",
  "ruleVersion": 3,
  "rolloutBasisPoints": 2500,
  "bucket": 817,
  "hashVersion": 1
}
```

Provenance deve ser retornada para diagnóstico interno; a API pública poderá reduzir campos se houver risco de exposição de targeting.

### Criar/alterar regra

```text
PUT /api/v1/feature-flags/{key}/rules
```

Payload conceitual:

```json
{
  "environment": "production",
  "target": {
    "type": "BRANCH",
    "companyId": "...",
    "branchId": "..."
  },
  "enabled": true,
  "rolloutBasisPoints": 2500,
  "expectedVersion": 2,
  "reason": "Rollout controlado da nova expedição"
}
```

Para criação, `expectedVersion` é omitido. Para alteração, é obrigatório. Quando o boundary HTTP de escrita for materializado, usar idempotency key sem substituir optimistic locking.

## Cache e consistência

Fonte de verdade: PostgreSQL.

Cache não é requisito da correção inicial. Quando introduzido, a chave deve incluir no mínimo:

```text
flag key
environment
tenant
company
branch
user/subject
plan context
```

Invalidação deve ser determinística após commit. Cache nunca pode cruzar Tenant nem manter decisão indefinidamente após kill-switch.

## Observabilidade

Métricas alvo, com cardinalidade controlada:

```text
feature_flag_evaluation_total{flag,source,outcome}
feature_flag_evaluation_error_total{flag,reason}
feature_flag_rule_write_total{target,outcome}
feature_flag_rollout_bucket_total{flag,enabled}
```

Logs estruturados devem incluir request/correlation IDs e provenance, sem PII ou secrets.

A fase 020 — Observabilidade Base introduzirá a plataforma transversal de OpenTelemetry; a 019 expõe hooks/contratos compatíveis sem antecipar a implementação transversal.

## Concorrência e consistência

- optimistic locking por `version`;
- unique partial indexes impedem regras ativas duplicadas por target;
- escrita de regra + histórico + Audit ocorre atomicamente;
- avaliação lê um snapshot consistente;
- restauração cria nova versão, nunca reescreve histórico;
- kill-switch (`enabled=false`) deve ter precedência determinística sem depender de cache eventual não invalidado.

## Segurança e casos de borda

- Feature Flag não é autorização;
- cliente não escolhe `environment` confiável;
- cliente não escolhe `planKey` confiável;
- User target é tenant-aware via Membership;
- cross-tenant UUID deve ser invisível/bloqueado;
- flag global desativada vence regras de Tenant;
- regra inativa é ignorada;
- percentual 0 desabilita a coorte; 10000 habilita toda a coorte quando `enabled=true`;
- mudança de hash requer nova `hash_version` explícita;
- ausência de userId usa tenantId como bucket subject em fluxos tenant-scoped;
- requests repetidos do mesmo subject devem produzir a mesma decisão;
- nenhuma decisão deve depender de ordem acidental de linhas no banco.

## Migração e validação

Implementado:

```text
db/migrations/0013_feature_flags.sql
db/validation/0013_feature_flags_validation.sql
```

Atualizado:

```text
db/runtime/runtime-access.sql
.github/workflows/ci.yml
```

Validações concluídas:

- PostgreSQL 18 limpo;
- runner de migrations e idempotência do histórico;
- constraints/FKs/unique partial indexes;
- RLS e cross-tenant;
- ACL runtime least privilege;
- append-only rule history;
- precedence e provenance;
- bucket determinístico e limites 0/10000;
- optimistic locking/stale update;
- integração com `AuthorizedTenantOperationService` e Audit;
- ausência de dependência em Billing ainda não implementado;
- secrets proibidos.

## Cadeia de release

```text
CI
→ Neon Staging
→ smoke + cleanup
→ Staging immutable artifact
→ rollback/restore
→ gate humano Production
→ Neon Main / Production
→ revision identity
→ health/database readiness
→ runtime observability
→ governança de fechamento
```

Mudanças de banco permaneceram backward-compatible com o artefato anterior durante rollout.

## Evidência final

```text
PR técnica                    = #93
functional/runtime revision   = 1dd64edb27be2edb8d22187b1997a315952cff08
Moventra CI                   = 32856005715 = success
Release Gate                  = 32856127017 = success
Rollback Drill                = 32856241092 = success
Production Promotion          = 32856385783 = success
Production deployment         = dpl_7ZMu3BuqtAFfRbPfVpmn2uUt5KcV = READY
Production stable URL         = https://moventra-tms-alebru.vercel.app
Production approval           = approved / approver alexoaraujo83
prevent_self_review           = true
can_admins_bypass             = false
migration                     = 0013_feature_flags.sql
migration SHA-256             = 2a22ee5ca00b0f3b7515d8a4f82ca37c3e0c7b4286c73348da7e91dde18ccb19
Neon staging                  = br-rapid-math-au6j6xut
Neon main                     = br-morning-glitter-au97suq4
health                        = 200
api/database-health           = 200
Production runtime errors     = none in validated deployment window
Production cross-tenant smoke = own=1 / cross-tenant=0
Production smoke residue      = 0
```

O smoke administrativo de Production restaurou integralmente a configuração de membership PostgreSQL usada para a validação, preservando o grant original de `cloud_admin` e sem deixar principals, flags, rules ou Tenants sintéticos.

## Fora do escopo

- substituir RBAC/Scope por flags;
- criar Billing/Planos antes da fase oficial correspondente;
- plataforma transversal OpenTelemetry da fase 020;
- UI administrativa completa;
- experiment analytics/estatística avançada;
- multi-variate flags além do booleano inicial;
- remote config genérico;
- armazenamento de secrets;
- qualquer fase posterior à 019.

## Critérios de conclusão

- [x] catálogo global de flags materializado;
- [x] política global por ambiente materializada;
- [x] rules tenant-scoped para Tenant/Empresa/Filial/User/Plan materializadas;
- [x] percentage rollout determinístico em basis points;
- [x] precedência e provenance comprovadas;
- [x] Membership/FKs tenant-aware preservados;
- [x] RBAC + Organizational Scope + RLS + Audit integrados;
- [x] runtime least-privilege/NOBYPASSRLS preservado;
- [x] history append-only comprovado;
- [x] optimistic locking e concorrência testados;
- [x] cross-tenant read/write bloqueados em PostgreSQL real;
- [x] Feature Flag comprovadamente não substitui autorização;
- [x] CI completo verde;
- [x] Neon Staging/Main e smoke sem resíduos;
- [x] Staging + rollback/restore;
- [x] Production somente após gate humano explícito e aprovação externa efetiva;
- [x] revision identity, health, database readiness e observabilidade verificadas;
- [x] documentação e Issue sincronizados; Confluence é atualizado pela governança de fechamento.

## Próxima fase

A fase **020 — Observabilidade Base = ACTIVE / DEFINED**. A fase 021 e todas as posteriores permanecem `NOT ACTIVE` até a conclusão formal da 020.