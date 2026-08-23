# 007 — Convenções de Dados

## Estado

`CONCLUDED`

Ativada em `2026-08-23` após:

```text
006 = CONCLUDED
B006-02 = RESOLVED
G1 = APPROVED
```

Concluída em `2026-08-23` após consolidação do contrato canônico, inclusão de guardrails automatizados e CI verde.

## Objetivo

Transformar as convenções de dados do Moventra TMS em contrato técnico explícito, verificável e reutilizável pelas migrations das fases 008 em diante, sem antecipar Tenant, Empresa, Filial, Usuários, Memberships, RBAC, RLS ou Auditoria.

## Fonte canônica

```text
docs/data/DATA-CONVENTIONS.md
```

O documento consolidado define, entre outros:

- `UUID`/UUIDv7 como padrão de identificador de domínio;
- `uuidv7()` como gerador PostgreSQL 18+ quando a PK for gerada no banco;
- separação entre PK técnica, business key e external ID;
- naming PostgreSQL em `snake_case`;
- tabelas de domínio no plural;
- classificação de escopo global/tenant/company/branch;
- `tenant_id UUID NOT NULL` em dados tenant-scoped e abaixo;
- uniques e FKs tenant-aware;
- `TIMESTAMPTZ`/UTC para instantes e timezone IANA para regras locais;
- `DATE` para datas civis;
- `NUMERIC(19,4)` como padrão inicial de montantes monetários;
- proibição de float binário e PostgreSQL `MONEY` para dinheiro;
- ISO 4217 para moeda quando aplicável;
- hard delete, soft delete, append-only, reversão e retenção/LGPD;
- `version BIGINT` para optimistic locking quando aplicável;
- constraints de banco como defesa de invariantes estruturais;
- locks transacionais somente para concorrência real;
- `CHECK`, tabelas de domínio, `ENUM` excepcional e state machines conforme estabilidade/evolução;
- migrations aplicadas imutáveis, com correção por forward-fix.

## Guardrails automatizados

Arquivo:

```text
tests/architecture/data-conventions.test.js
```

O check atual valida de forma proporcional ao baseline:

- presença dos contratos obrigatórios no documento canônico;
- proibição de tipos `SERIAL` como padrão de identidade;
- proibição do tipo PostgreSQL `MONEY`;
- `*_at` usando `TIMESTAMPTZ` nas migrations;
- `*_amount` usando `NUMERIC`/`DECIMAL` com precisão explícita;
- `tenant_id`, quando presente, como `UUID NOT NULL`;
- PK UUID gerada no banco usando `uuidv7()`;
- nomes verificáveis de tabelas/constraints em `snake_case`.

Esses checks são guardrails e não substituem schema review nem validation SQL.

## Quality gates da 007

- [x] contrato de identificadores aprovado;
- [x] contrato de timestamps/timezone aprovado;
- [x] contrato monetário aprovado;
- [x] padrão de naming de tabelas, colunas, FKs, constraints e índices aprovado;
- [x] política de hard delete/soft delete/histórico/retenção aprovada;
- [x] padrão de optimistic locking/concorrência definido;
- [x] regras tenant/company/branch formalizadas;
- [x] decisão sobre `CHECK`/enum/tabela de domínio/state machine registrada;
- [x] testes/linters de arquitetura adicionados para violações verificáveis;
- [x] `DATA-CONVENTIONS.md` consolidado como fonte canônica;
- [x] CI verde;
- [x] nenhuma entidade da fase 008+ criada antecipadamente.

## Evidência executada

Implementação técnica:

```text
PR #51 — docs(data): consolidate phase 007 conventions
merge commit = 46e08ce5cefe2c5d3df9eb89bcaee096dc9f9fa5
```

CI do head validado antes do merge:

```text
Foundation CI
run = 32672159870
conclusion = success

Moventra CI
run = 32672159907
conclusion = success
```

No Moventra CI passaram:

```text
Repository contract
Lint
Tests
PostgreSQL migration contract
Security baseline
PostgreSQL runtime dependencies
Build immutable artifact
CI evidence
```

A PR alterou somente:

```text
docs/data/DATA-CONVENTIONS.md
tests/architecture/data-conventions.test.js
```

Nenhuma migration `0002`, entidade de Tenant, schema de domínio ou recurso da fase 008+ foi introduzido pela 007.

## Resultado de promoção

Todos os critérios foram satisfeitos. A transição oficial é:

```text
007 = CONCLUDED
008 — Tenant = ACTIVE
G2 = NOT APPROVED
```

A fase 008 passa a ser a única etapa estrutural autorizada para implementação. Empresa, Filial, Usuários, Memberships, Auth, RBAC, Escopo Organizacional, RLS e Auditoria permanecem não ativas até suas respectivas promoções.