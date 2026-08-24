# 010 — Filial

## Estado

`ACTIVE / DEFINED`

Ativada oficialmente após:

```text
009 — Empresa = CONCLUDED
G1 = APPROVED
```

Permanecem:

```text
011 — Usuários = NOT ACTIVE
G2 = NOT APPROVED
```

## Objetivo

Materializar **Filial** como unidade organizacional/operacional subordinada a uma Empresa e pertencente ao mesmo Tenant no Moventra TMS.

Filial integra a hierarquia canônica:

```text
Tenant
└── Empresa
    └── Filial
```

Ela não se confunde com:

- Tenant — conta/raiz SaaS;
- Empresa — organização jurídica/operacional corporativa;
- depósito/armazém — entidade logística futura quando o domínio exigir;
- ponto de coleta/entrega — entidade operacional futura;
- cliente comercial — domínio CRM/Comercial;
- usuário/membership — fases 011/012.

## Fontes obrigatórias

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/architecture/ADR-0002-tenant-isolation.md`;
- `docs/implementation/008-tenant.md`;
- `docs/implementation/009-empresa.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`;
- migration framework em `scripts/db/migrate.mjs`.

## Escopo da fase 010

A fase deve implementar somente Filial e os artefatos mínimos para provar suas invariantes:

- identidade UUIDv7;
- `tenant_id UUID NOT NULL`;
- `company_id UUID NOT NULL`;
- business key estável e única dentro da Empresa;
- nome de exibição obrigatório;
- indicação opcional de matriz/sede operacional (`is_headquarters`) com no máximo uma por Empresa;
- país de registro/unidade quando necessário para identificadores jurisdicionais;
- identificador fiscal de estabelecimento opcional e genérico;
- lifecycle/status explícito;
- overrides opcionais de timezone e moeda, herdando Empresa/Tenant quando ausentes;
- timestamps técnicos;
- optimistic locking;
- constraints e índices tenant/company-aware;
- FK composta para Empresa;
- chave candidata composta para referências futuras;
- migration e validation SQL;
- domínio/persistência mínima;
- testes unitários, negativos, cross-tenant e cross-company.

## Não escopo

A fase 010 **NÃO DEVE** criar:

```text
users
memberships
roles
permissions
sessions
audit_logs
RLS policies
warehouses
addresses
contacts
customers
contracts
fiscal documents
financial accounts
```

Endereço físico completo, contatos, geolocalização e capacidades operacionais específicas da filial devem entrar somente quando o respectivo domínio/necessidade for formalmente ativado.

## Modelo relacional alvo

Tabela:

```text
organization.branches
```

Estrutura recomendada:

| Campo | Regra |
|---|---|
| `id` | `UUID NOT NULL DEFAULT uuidv7()`; PK imutável |
| `tenant_id` | `UUID NOT NULL`; boundary SaaS |
| `company_id` | `UUID NOT NULL`; Empresa pai no mesmo Tenant |
| `code` | business key estável; lowercase; única por Empresa |
| `display_name` | nome operacional/exibição; obrigatório |
| `is_headquarters` | boolean; no máximo uma sede por Empresa |
| `registration_country` | ISO 3166-1 alpha-2 opcional quando necessário |
| `primary_tax_identifier_type` | tipo jurisdicional opcional |
| `primary_tax_identifier` | valor normalizado opcional; pareado ao tipo/país |
| `status` | lifecycle explícito |
| `default_timezone` | override IANA opcional; `NULL` herda Empresa/Tenant |
| `default_currency` | override ISO 4217 opcional; `NULL` herda Empresa/Tenant |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `version` | `BIGINT NOT NULL DEFAULT 1`; optimistic locking |

## Chaves e integridade tenant-aware

A migration deve incluir, no mínimo:

```text
PK (id)
FK (tenant_id, company_id)
  -> organization.companies(tenant_id, id)
UNIQUE (tenant_id, company_id, id)
UNIQUE (tenant_id, company_id, code)
INDEX (tenant_id, company_id, status)
```

A FK composta é obrigatória. Não é suficiente referenciar apenas `company_id`, pois a integridade deve provar no próprio banco que a Filial pertence ao mesmo Tenant da Empresa.

Para `is_headquarters = true`, usar índice unique parcial equivalente a:

```text
UNIQUE (tenant_id, company_id) WHERE is_headquarters
```

Isso garante no máximo uma sede/matriz marcada por Empresa sem exigir que toda Empresa já possua uma Filial sede.

Quando identificador fiscal de estabelecimento for informado, sua unicidade deve ser tenant-aware e jurisdicional, evitando uma constraint global que bloqueie valores legitimamente repetidos em tenants distintos.

## Relações e cardinalidade

```text
Tenant 1 ─────── 0..N Empresa
Empresa 1 ────── 0..N Filial
Filial N ─────── 1 Empresa
Filial N ─────── 1 Tenant
```

Regras:

1. toda Filial pertence a exatamente uma Empresa;
2. toda Filial pertence ao mesmo Tenant da Empresa;
3. `tenant_id` e `company_id` são imutáveis após criação;
4. mover Filial entre Empresas/Tenants não é operação de update comum;
5. `code` é único dentro da Empresa;
6. Tenant e Empresa não operacionais tornam a Filial não operacional independentemente do status local;
7. `is_headquarters` é uma característica organizacional, não um status lifecycle.

## Lifecycle proposto

Estados:

```text
DRAFT
ACTIVE
INACTIVE
CLOSED
```

Transições:

```text
DRAFT    -> ACTIVE | CLOSED
ACTIVE   -> INACTIVE | CLOSED
INACTIVE -> ACTIVE | CLOSED
CLOSED   -> terminal
```

Ativação de Filial exige simultaneamente:

```text
Tenant.status = ACTIVE
Company.status = ACTIVE
```

`status` não pode ser alterado por CRUD arbitrário.

## Herança de configuração

Timezone efetivo:

```text
branch.default_timezone
?? company.default_timezone
?? tenant.default_timezone
```

Moeda efetiva:

```text
branch.default_currency
?? company.default_currency
?? tenant.default_currency
```

A fase 010 deve persistir somente overrides. Não duplicar valores herdados automaticamente na tabela da Filial.

## Concorrência

Toda mutação usa optimistic locking:

```text
WHERE tenant_id = ?
  AND company_id = ?
  AND id = ?
  AND version = expected_version
SET version = version + 1
```

Transições também devem condicionar o status esperado.

Alteração de `is_headquarters` exige tratamento transacional/concorrente para evitar duas sedes simultâneas. A constraint unique parcial funciona como última linha de defesa.

## Isolamento tenant/company-aware

Mesmo antes de RLS, repository methods devem exigir contexto explícito de Tenant e Empresa.

Não oferecer mutações de negócio por:

```text
branch_id isolado
company_id isolado sem tenant_id
```

Leituras/mutações devem usar:

```text
tenant_id + company_id + branch_id/business key
```

Testes devem provar que:

```text
tenant incorreto não lê/altera Filial
company incorreta dentro do mesmo tenant não lê/altera Filial
mesmo code em Empresas diferentes = permitido
mesmo code na mesma Empresa = rejeitado
```

## Segurança e LGPD

- autorização crítica permanece no backend;
- UUID não é autorização;
- `tenant_id`/`company_id` do payload do cliente não substituem o contexto autorizado;
- identificadores fiscais devem ser minimizados e protegidos;
- não registrar payloads completos desnecessariamente;
- RLS permanece fase 016;
- futura auditoria transversal permanece fase 017.

## Migration esperada

```text
db/migrations/0004_branch.sql
```

Validation SQL:

```text
db/validation/0004_branch_validation.sql
```

A migration deve criar somente artefatos da fase 010 e não pode alterar migrations 0001/0002/0003 já aplicadas.

## Domínio/persistência esperados

```text
src/modules/organization/branch/branch-domain.js
src/modules/organization/branch/branch-repository.js
```

Sem introduzir ORM ou nova infraestrutura.

## Testes mínimos

### Domínio

- criação válida em `DRAFT`;
- code normalizado;
- display name válido;
- país/identificador fiscal opcional coerente;
- timezone/moeda opcionais;
- lifecycle válido/ inválido;
- `CLOSED` terminal;
- Tenant não ativo impede ativação;
- Empresa não ativa impede ativação.

### Persistência

- create/read tenant+company-scoped;
- optimistic locking;
- stale version rejeitada;
- transition condicionada por tenant/company/id/status/version;
- mesmo code em Empresas diferentes permitido;
- duplicidade na mesma Empresa rejeitada;
- tenant incorreto não acessa;
- company incorreta não acessa;
- `tenant_id`/`company_id` imutáveis;
- concorrência de headquarters protegida.

### Banco/arquitetura

- migration `0004` aplica após 0001/0002/0003 em PostgreSQL 18;
- reexecução preserva histórico;
- validation SQL passa;
- FK composta Empresa existe;
- `(tenant_id, company_id, id)` é unique;
- business key tenant/company-aware;
- unique parcial de headquarters existe;
- nenhuma tabela/entidade 011+ é criada.

## Quality gates

A fase somente pode ser concluída quando:

- [ ] modelo de Filial revisado contra 007/008/009/ADR-0002;
- [ ] lifecycle formalizado;
- [ ] herança timezone/moeda formalizada;
- [ ] contrato de sede/matriz formalizado;
- [ ] migration `0004_branch.sql` implementada;
- [ ] validation SQL implementada;
- [ ] migration validada em PostgreSQL 18 limpo após 0001/0002/0003;
- [ ] reexecução/histórico idempotente validado;
- [ ] FK composta para Empresa validada;
- [ ] unicidades tenant/company-aware validadas;
- [ ] domínio/persistência implementados;
- [ ] optimistic locking validado;
- [ ] testes cross-tenant e cross-company aprovados;
- [ ] testes negativos aprovados;
- [ ] lint/test/build verdes;
- [ ] PostgreSQL migration contract verde;
- [ ] migration aplicada e validada em Neon staging e main;
- [ ] staging runtime validado;
- [ ] rollback/restore validado;
- [ ] protected Production promotion concluída sem bypass;
- [ ] Production revision identity/health/readiness validados;
- [ ] documentação/issue atualizadas;
- [ ] nenhuma fase 011+ antecipada.

## Critério de promoção

Somente após todos os quality gates:

```text
010 = CONCLUDED
011 — Usuários = ACTIVE / DEFINED
```

Até lá:

```text
010 = ACTIVE
011 = NOT ACTIVE
G2 = NOT APPROVED
```

## Próxima unidade de trabalho

Executar DELTA AUDIT da fase 010 e implementar a unidade Filial sem antecipar Usuários/Memberships/Auth/RBAC/RLS/Auditoria.
