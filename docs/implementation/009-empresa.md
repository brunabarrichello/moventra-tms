# 009 — Empresa

## Estado

`ACTIVE / DEFINED`

Ativada oficialmente após:

```text
008 — Tenant = CONCLUDED
G1 = APPROVED
```

Permanecem:

```text
010 — Filial = NOT ACTIVE
G2 = NOT APPROVED
```

## Objetivo

Materializar **Empresa** como organização jurídica/operacional pertencente a um Tenant do Moventra TMS.

Empresa é tenant-scoped e representa a pessoa jurídica ou unidade empresarial de nível corporativo sob a qual operações, contratos, documentos, faturamento e filiais poderão futuramente ser organizados. Ela não se confunde com:

- Tenant — conta/raiz SaaS;
- Filial — unidade organizacional subordinada à Empresa, fase 010;
- cliente comercial do TMS — entidade futura do domínio CRM/Comercial;
- usuário/membership — identidade e vínculo de acesso, fases 011/012.

## Fontes obrigatórias

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/architecture/ADR-0002-tenant-isolation.md`;
- `docs/implementation/008-tenant.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`;
- migration framework em `scripts/db/migrate.mjs`.

## Escopo da fase 009

A fase deve implementar somente o agregado/entidade Empresa e os artefatos mínimos para provar suas invariantes:

- identidade técnica UUIDv7;
- `tenant_id UUID NOT NULL`;
- business key estável e única dentro do Tenant;
- nome jurídico e nome de exibição/fantasia quando aplicável;
- país de registro em código ISO 3166-1 alpha-2;
- identificador fiscal primário genérico/jurisdicional quando informado;
- lifecycle/status explícito;
- overrides opcionais de timezone e moeda, herdando Tenant quando ausentes;
- timestamps técnicos;
- optimistic locking;
- constraints e índices tenant-aware;
- FK para Tenant;
- chave candidata `(tenant_id, id)` para FKs tenant-aware das fases seguintes;
- migration e validation SQL;
- domínio/persistência mínima;
- testes unitários, negativos e de contrato de banco.

## Não escopo

A fase 009 **NÃO DEVE** criar:

```text
branches
users
memberships
roles
permissions
sessions
audit_logs
RLS policies
customers
contracts
billing entities
fiscal documents
```

Também não deve criar tabelas de endereço, contatos ou múltiplas inscrições fiscais sem uma decisão própria de domínio. Esses conceitos poderão ser adicionados nas fases/domínios adequados, evitando transformar Empresa em depósito de dados futuros.

## Modelo relacional alvo

Tabela:

```text
organization.companies
```

Estrutura recomendada para implementação:

| Campo | Regra |
|---|---|
| `id` | `UUID NOT NULL DEFAULT uuidv7()`; PK imutável |
| `tenant_id` | `UUID NOT NULL`; FK para `organization.tenants(id)` |
| `code` | business key estável; lowercase; única por Tenant |
| `legal_name` | nome jurídico; obrigatório; normalizado no boundary |
| `display_name` | nome de exibição/fantasia; opcional |
| `registration_country` | ISO 3166-1 alpha-2, uppercase |
| `primary_tax_identifier_type` | tipo jurisdicional opcional, ex.: `CNPJ`, `EIN`, `VAT`; sem enum PostgreSQL rígido |
| `primary_tax_identifier` | valor normalizado opcional; deve ser pareado com o tipo |
| `status` | lifecycle explícito |
| `default_timezone` | override IANA opcional; `NULL` herda Tenant |
| `default_currency` | override ISO 4217 opcional; `NULL` herda Tenant |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `version` | `BIGINT NOT NULL DEFAULT 1`; optimistic locking |

A migration deve incluir:

```text
PK (id)
FK (tenant_id) -> organization.tenants(id)
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, code)
INDEX (tenant_id, status)
```

Quando `primary_tax_identifier` existir, sua unicidade deve ser tenant-aware e jurisdicional, preferencialmente por índice/constraint parcial equivalente a:

```text
(tenant_id, registration_country, primary_tax_identifier_type, primary_tax_identifier)
```

O valor deve ser persistido normalizado. Regras de validação específicas de CNPJ/EIN/VAT pertencem ao boundary/domínio e não devem ser codificadas como regex universal no banco.

## Relação Tenant → Empresa

Cardinalidade:

```text
Tenant 1 ─────── 0..N Empresa
Empresa N ────── 1 Tenant
```

Regras:

1. Empresa sempre pertence a exatamente um Tenant;
2. `tenant_id` é imutável após criação — mover Empresa entre tenants não é operação suportada;
3. `code` é único somente dentro do Tenant, permitindo o mesmo código em tenants distintos;
4. o backend nunca deve aceitar `tenant_id` do cliente como autorização suficiente;
5. ativação operacional de Empresa exige Tenant em estado `ACTIVE` no serviço de domínio;
6. encerramento/suspensão do Tenant prevalece sobre capacidade operacional da Empresa, mesmo que o status da Empresa permaneça `ACTIVE`.

## Lifecycle proposto

Estados iniciais:

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

Semântica:

- `DRAFT`: cadastro incompleto ou ainda não liberado para operação;
- `ACTIVE`: empresa operacional;
- `INACTIVE`: desativação administrativa reversível;
- `CLOSED`: encerramento terminal; histórico deve ser preservado.

`status` não pode ser alterado por CRUD arbitrário. A camada de domínio deve validar a transição e o estado do Tenant.

## Exclusão e retenção

A fase não deve usar hard delete como operação normal de Empresa. Empresas participam de relações operacionais, fiscais e financeiras futuras e precisam preservar identidade histórica.

A exclusão lógica não é necessária se `CLOSED` cumprir o lifecycle. Qualquer futura anonimização/retention deve seguir LGPD, obrigações fiscais e `DATA-CONVENTIONS.md` sem destruir referências históricas.

## Concorrência

Toda mutação deve usar optimistic locking:

```text
WHERE tenant_id = ?
  AND id = ?
  AND version = expected_version
SET version = version + 1
```

Zero linhas atualizadas representa conflito de concorrência/recurso inexistente no escopo e deve ser convertido para erro de domínio/HTTP 409 quando aplicável.

Transições devem condicionar também o `status` esperado quando isso fortalecer a invariante.

## Isolamento tenant-aware

Mesmo antes de RLS, toda leitura/mutação de Empresa deve receber o contexto de Tenant explicitamente e consultar por:

```text
tenant_id + company_id/business key
```

Repository methods não devem oferecer variantes inseguras de atualização por `id` isolado.

A futura Filial deverá poder usar FK composta:

```text
(tenant_id, company_id)
    -> organization.companies(tenant_id, id)
```

Por isso `UNIQUE (tenant_id, id)` é obrigatório na 009.

## Segurança e LGPD

- nenhuma autorização deve depender somente do UUID;
- nenhum secret deve ser armazenado em `companies`;
- identificadores fiscais devem ser minimizados e protegidos conforme classificação de dados;
- logs não devem despejar payload completo de Empresa sem necessidade;
- RLS permanece fora de escopo até a fase 016;
- testes da 009 devem provar que repository updates não cruzam `tenant_id`.

## Migration esperada

```text
db/migrations/0003_company.sql
```

Validation SQL:

```text
db/validation/0003_company_validation.sql
```

A migration deve criar somente artefatos pertencentes à 009 e não pode alterar migrations 0001/0002 já aplicadas.

## Domínio/persistência esperados

Sem introduzir ORM ou nova infraestrutura:

```text
src/modules/organization/company/company-domain.js
src/modules/organization/company/company-repository.js
```

O repository deve operar com `pg`/node-postgres e seguir o padrão estabelecido pelo Tenant.

## Testes mínimos

### Domínio

- criação válida em `DRAFT`;
- normalização/validação de code;
- validação ISO country;
- pareamento de tax identifier type/value;
- timezone IANA opcional;
- currency opcional;
- transições válidas;
- transições inválidas;
- `CLOSED` terminal;
- Tenant não ativo impede ativação de Empresa.

### Persistência

- create/read tenant-scoped;
- update com optimistic locking;
- stale version rejeitada;
- transition com tenant + id + versão/status;
- mesmo `code` permitido em tenants diferentes;
- mesmo `code` rejeitado dentro do mesmo Tenant;
- update usando tenant incorreto não altera registro;
- `tenant_id` não é mutável.

### Banco/arquitetura

- migration `0003` aplica em banco limpo após 0001/0002;
- reexecução do runner preserva histórico;
- validation SQL passa;
- tabela possui `tenant_id UUID NOT NULL`;
- FK para Tenant existe;
- `(tenant_id, id)` é unique;
- nenhuma tabela/entidade 010+ é criada.

## Quality gates

A fase somente pode ser concluída quando:

- [ ] modelo de Empresa revisado e coerente com 007/008/ADR-0002;
- [ ] lifecycle formalizado;
- [ ] contrato de identificador fiscal primário definido sem acoplamento exclusivo ao Brasil;
- [ ] migration `0003` implementada;
- [ ] validation SQL implementada;
- [ ] migration executa em PostgreSQL 18 limpo após 0001/0002;
- [ ] reexecução/histórico de migration validada;
- [ ] FK Tenant e unicidades tenant-aware validadas;
- [ ] `(tenant_id, id)` disponível para futuras FKs compostas;
- [ ] domínio/persistência mínima implementados;
- [ ] optimistic locking validado;
- [ ] testes negativos e cross-tenant de repository aprovados;
- [ ] lint/test/build verdes;
- [ ] PostgreSQL migration contract verde;
- [ ] migration aplicada/validada em Neon staging e main;
- [ ] staging runtime validado;
- [ ] protected Production promotion concluída sem bypass;
- [ ] production revision identity/health/readiness validados;
- [ ] documentação e issue atualizadas;
- [ ] nenhuma fase 010+ antecipada.

## Critério de promoção

Somente após todos os quality gates:

```text
009 = CONCLUDED
010 — Filial = ACTIVE / DEFINED
```

Até lá:

```text
009 = ACTIVE
010 = NOT ACTIVE
G2 = NOT APPROVED
```

## Próxima unidade de trabalho

Executar um DELTA AUDIT da 009 contra o código/migrations atuais e implementar `0003_company.sql`, validation SQL, domínio, repository e testes sem antecipar Filial.