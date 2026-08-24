# 017 — Auditoria Central

## Estado

`CONCLUDED`

Fase final do batch 012–017 concluída após CI, Neon Staging/Main, rollback/restore, aprovação externa do environment protegido e promoção Production da revisão funcional final.

## Objetivo

Fornecer trilha central, append-only e consultável para decisões de segurança, alterações administrativas e ações críticas, mantendo separação entre Audit Trail, logs operacionais e futuros ledgers Financeiro/Fiscal.

## Modelo implementado

`audit.audit_events` é explicitamente tenant-scoped e registra:

- `tenant_id NOT NULL` em todos os eventos;
- contexto Empresa/Filial quando aplicável;
- ator User/Membership quando conhecido;
- `category`, `action`, entidade e resultado;
- request/correlation IDs e motivo;
- before/after/metadata estruturados, minimizados e redigidos;
- timestamp imutável.

Eventos administrativos verdadeiramente globais não usam `tenant_id = NULL` nesta tabela. Se necessários, deverão constituir agregado administrativo separado, com autorização e políticas próprias.

## Imutabilidade e LGPD

- UPDATE e DELETE são bloqueados por trigger com SQLSTATE `55000`;
- repository expõe somente `append`;
- corrections posteriores geram novo evento, nunca reescrevem histórico;
- passwords, secrets, credentials, tokens, cookies, authorization headers, private keys e DATABASE_URL são redigidos antes da persistência;
- payloads possuem limites de tamanho/profundidade;
- PII deve ser minimizada conforme finalidade;
- Audit Trail usa RLS tenant-aware e contexto autorizado da fase 016.

## Coerência organizacional

- `actor_membership_id` é validado por `(tenant_id, actor_membership_id)`;
- Empresa por `(tenant_id, company_id)`;
- Filial por `(tenant_id, company_id, branch_id)`;
- Filial exige Empresa no mesmo Tenant.

## Atomicidade

Quando o evento representar o resultado de uma mutação crítica, Audit e mutação de negócio devem usar a mesma conexão/transação, garantindo commit ou rollback conjunto.

## Migration

```text
migration = db/migrations/0011_audit.sql
checksum  = 5f982ae3894d48833f27d447d24d932ddb99c3a3d2e6cb13eb823d9d67c86fa9
```

A migration final foi corrigida antes da promoção para manter `tenant_id NOT NULL`, alinhando a Auditoria às convenções canônicas de isolamento. O domínio também passou a exigir Tenant explicitamente; a convenção não foi relaxada.

## Neon Staging

- migrations 0007–0011 presentes com checksums canônicos;
- validation 0011 verde;
- `tenant_id NOT NULL`, trigger append-only e RLS confirmados;
- smoke transacional inseriu evento, comprovou UPDATE/DELETE bloqueados e realizou rollback;
- cleanup final: zero registros de smoke.

## Neon Main / Production Database

Migrations 0007–0011 foram promovidas **em ordem** antes do deploy de aplicação final.

Validação final:

```text
audit.audit_events              = present
audit tenant_id NOT NULL        = true
append-only trigger             = present
audit tenant RLS policy         = present
security.current_tenant_id()    = present
tenant_isolation_* policy count = 10
```

Smoke transacional em Main repetiu o bloqueio de UPDATE/DELETE e terminou com zero dados temporários.

## Staging final e rollback/restore

```text
initial current = dpl_5YVSGThohdFArhqJ17Q9dQSEdQZv = READY
rollback        = dpl_6eBXjqEorxDevA5YmwfmiyAsWZpK = READY
restore         = dpl_47QXsmARhqek91jbyeSJBCM5TKoZ = READY
```

No deployment corrente inicial, `/health` e `/api/database-health` retornaram 200. Rollback e restore tiveram smoke `/health` 200.

O warning futuro de semântica SSL do pacote `pg` permaneceu não bloqueante porque database-health retornou 200; deve ser tratado como hardening posterior, sem alterar a evidência de readiness desta fase.

## Production final

A aprovação explícita em chat foi seguida pela aprovação externa efetiva do environment protegido `production`. Nenhum bypass foi usado.

```text
functional/runtime revision = 6b80fe7903b5ba742041508cb7465ff529215139
Production deployment        = dpl_EHVA4pRhCchcn6Nrn43uTefpUuue
state                        = READY
target                       = production
/health                      = 200 × 2
/api/database-health         = 200 × 2
runtime errors               = none observed
```

A revision identity é garantida pela cadeia de artefato imutável e pelo preflight fail-closed da promoção, que exige rollback evidence da revisão corrente, artefato exato e `current main = restore SHA` antes do job protegido. O body direto de `/health` é protegido por Vercel SSO; disponibilidade/readiness foram confirmadas por runtime logs do deployment exato.

## Resultado

```text
012 = CONCLUDED
013 = CONCLUDED
014 = CONCLUDED
015 = CONCLUDED
016 = CONCLUDED
017 = CONCLUDED
G2 — Security Ready = APPROVED
```

A promoção de aplicação Production ocorreu uma única vez no fechamento da 017, conforme governança da Issue #69.
