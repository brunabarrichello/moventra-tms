# 007 — Convenções de Dados

## Estado

`ACTIVE`

Ativada oficialmente em `2026-08-23` após:

```text
006 = CONCLUDED
B006-02 = RESOLVED
G1 = APPROVED
```

## Objetivo

Transformar as convenções de dados já definidas para o Moventra TMS em um contrato técnico explícito, verificável e reutilizável pelas migrations das fases 008 em diante.

A fase 007 não cria Tenant, Empresa, Filial, Usuários, Memberships, RBAC ou Auditoria. Seu papel é congelar os padrões que essas entidades deverão obedecer.

## Fonte base

Documento vigente:

```text
docs/data/DATA-CONVENTIONS.md
```

Princípios já definidos:

- UUID ordenável temporalmente, com UUIDv7 como referência para novos agregados;
- `tenant_id` nas entidades tenant-scoped;
- `company_id` e `branch_id` somente quando houver escopo real;
- `TIMESTAMPTZ` e UTC para instantes;
- timezone de negócio preservado quando necessário;
- valores monetários sem ponto flutuante binário;
- moeda explícita quando houver cenário multi-moeda;
- soft delete somente quando justificado;
- imutabilidade lógica para financeiro, fiscal e auditoria;
- proteção transacional de invariantes concorrentes;
- auditoria com ator, escopo, ação, entidade, before/after e correlação;
- índices orientados a consultas reais e escopo tenant-aware;
- state machines para processos relevantes.

## Decisões que a fase deve consolidar

### 1. Identificadores

Definir o padrão executável para:

- PKs internas;
- UUIDv7 ou mecanismo equivalente aprovado;
- chaves de negócio;
- IDs externos de integrações;
- exposição segura de identificadores em APIs.

### 2. Datas e fusos

Definir contrato para:

- `created_at` / `updated_at`;
- timestamps técnicos em UTC;
- datas civis sem horário;
- timezone por tenant/empresa/filial quando aplicável;
- janelas operacionais e datas fiscais.

### 3. Valores monetários

Definir:

- tipo PostgreSQL padrão;
- precisão/escala por categoria;
- código de moeda;
- arredondamento;
- representação em API;
- proibição de `float`/`double` para dinheiro.

### 4. Concorrência e versionamento

Definir onde aplicar:

- optimistic locking/version column;
- constraints de unicidade tenant-aware;
- locks transacionais;
- idempotência em operações críticas futuras.

### 5. Exclusão, histórico e retenção

Distinguir explicitamente:

- hard delete permitido;
- soft delete;
- append-only;
- reversão/estorno;
- retenção e anonimização futura sob LGPD.

### 6. Nomenclatura e schemas

Padronizar:

- snake_case no PostgreSQL;
- nomes de PK/FK;
- nomes de constraints e índices;
- schemas técnicos versus schemas de domínio;
- pluralização de tabelas;
- colunas de metadados comuns.

### 7. Escopo SaaS

Formalizar regras para:

- `tenant_id` obrigatório em dados tenant-scoped;
- unicidade composta por tenant quando aplicável;
- `company_id`/`branch_id` sem duplicar escopo desnecessário;
- proibição de consultas futuras sem contexto organizacional quando o recurso for scoped.

### 8. Estados e domínios

Definir quando usar:

- `CHECK`;
- tabela de domínio;
- enum PostgreSQL;
- state machine na aplicação;
- status versionados/configuráveis.

## Quality gates da 007

A fase somente poderá ser concluída quando houver evidência de:

- [ ] contrato de identificadores aprovado;
- [ ] contrato de timestamps/timezone aprovado;
- [ ] contrato monetário aprovado;
- [ ] padrão de naming de tabelas, colunas, FKs, constraints e índices aprovado;
- [ ] política de soft delete/histórico aprovada;
- [ ] padrão de optimistic locking/concorrência definido;
- [ ] regras tenant/company/branch formalizadas;
- [ ] decisão sobre enums/tabelas de domínio/state machines registrada;
- [ ] testes/linters de arquitetura capazes de bloquear violações verificáveis;
- [ ] documentação `DATA-CONVENTIONS.md` atualizada como fonte canônica;
- [ ] nenhuma entidade da fase 008+ criada antecipadamente.

## Critério de promoção

Somente após todos os gates acima:

```text
007 = CONCLUDED
008 — Tenant = ACTIVE
```

Até lá:

```text
008 = NOT ACTIVE
G2 = NOT APPROVED
```

## Próxima unidade de trabalho

Consolidar `DATA-CONVENTIONS.md` em contrato implementável e adicionar validações automatizadas proporcionais ao baseline atual antes de iniciar a migration de Tenant.