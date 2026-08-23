# 008 — Tenant

## Estado

`ACTIVE / DEFINED`

Ativada oficialmente após:

```text
007 = CONCLUDED
G1 = APPROVED
```

G2 permanece:

```text
NOT APPROVED
```

## Objetivo

Materializar o **Tenant** como agregado raiz SaaS do Moventra TMS, com modelo relacional, invariantes, migration, validation SQL, camada de domínio/persistência mínima e testes proporcionais, sem antecipar Empresa, Filial, Usuários, Memberships, Auth, RBAC, RLS ou Auditoria.

Tenant representa o cliente/conta SaaS e define a fronteira primária de isolamento lógico da plataforma. Ele não deve ser confundido com empresa jurídica, filial, cliente comercial do TMS ou usuário.

## Fontes obrigatórias

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/architecture/ADR-0002-tenant-isolation.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`;
- migration framework vigente em `scripts/db/migrate.mjs`.

## Escopo da fase 008

A 008 deve definir e implementar somente os elementos necessários ao ciclo de vida do Tenant:

- identidade técnica UUIDv7;
- chave/código de negócio estável quando necessário;
- nome de exibição do tenant;
- status/lifecycle explícito;
- timezone padrão do tenant;
- moeda padrão do tenant quando aplicável à configuração SaaS inicial;
- timestamps técnicos;
- optimistic locking quando aplicável;
- constraints e índices;
- repository/serviço mínimo necessário para provar persistência e invariantes;
- testes unitários, de integração e de contrato de banco aplicáveis.

O desenho final de campos deve ser validado antes da migration para evitar transformar Tenant em depósito de configurações futuras.

## Não escopo

A fase 008 **NÃO DEVE** criar:

```text
companies
branches
users
memberships
roles
permissions
sessions
audit_logs
RLS policies
clientes comerciais
billing SaaS completo
feature flags
configurações hierárquicas completas
```

Referências a conceitos futuros podem existir somente como documentação de dependência, sem tabelas, FKs ou APIs antecipadas.

## Modelo relacional alvo

O schema de domínio para Tenant deve seguir o ADR de tenancy e o contrato de dados. A proposta deve privilegiar um único agregado raiz, sem duplicar dados de Empresa.

Requisitos estruturais mínimos:

```text
PK              = UUID / uuidv7()
status          = domínio estável e validado
created_at      = TIMESTAMPTZ NOT NULL
updated_at      = TIMESTAMPTZ NOT NULL
version         = BIGINT quando houver edição concorrente
soft delete     = somente se o lifecycle justificar
```

O Tenant é a própria raiz do escopo e, portanto, sua tabela raiz não carrega `tenant_id` apontando para si mesma. Entidades tenant-scoped das fases seguintes carregarão `tenant_id` conforme `DATA-CONVENTIONS.md`.

## Lifecycle

Estados iniciais a validar na implementação:

```text
PROVISIONING
ACTIVE
SUSPENDED
CLOSING
CLOSED
```

A implementação deve decidir formalmente:

- quais transições são válidas;
- quais estados permitem operação normal;
- se `CLOSED` é terminal;
- se suspensão é reversível;
- como lifecycle se relaciona com exclusão e retenção.

Status não pode ser editado arbitrariamente como CRUD sem validação de transição.

## Invariantes mínimas

A implementação deve garantir:

1. `id` imutável e UUIDv7 quando gerado pelo banco;
2. business key, se existir, separada da PK;
3. timezone em identificador IANA válido no boundary da aplicação;
4. status dentro do domínio aprovado;
5. timestamps coerentes;
6. nenhuma relação cross-tenant — ainda que a fase 008 contenha apenas a raiz;
7. nenhuma FK para entidades de fases 009+;
8. migration idempotente pelo framework e validation SQL correspondente;
9. nenhuma alteração destrutiva da migration 0001.

## Migration esperada

A primeira migration de domínio poderá ser:

```text
db/migrations/0002_tenant.sql
```

com validação correspondente:

```text
db/validation/0002_tenant_validation.sql
```

O nome final deve obedecer o padrão do migration framework vigente.

A migration deve criar apenas o schema/tabela/constraints necessários ao Tenant e não pode materializar fases posteriores.

## Segurança

Mesmo antes de Auth/RBAC/RLS:

- APIs futuras não podem confiar em ID fornecido pelo cliente como autorização;
- nenhum secret deve ser persistido na tabela de Tenant;
- dados pessoais devem ser minimizados nesta fase;
- RLS não deve ser antecipada sem o contexto definido nas fases posteriores;
- testes devem preparar a futura defesa cross-tenant sem fingir que ela já está implementada.

## Testes e quality gates

A fase somente poderá ser concluída quando houver evidência de:

- [ ] modelo de Tenant revisado e compatível com `DATA-CONVENTIONS.md`;
- [ ] lifecycle/status formalizado;
- [ ] migration `0002` criada sem entidades 009+;
- [ ] validation SQL criada e passando em banco limpo;
- [ ] reexecução de migration preserva histórico/idempotência do runner;
- [ ] constraints e índices necessários validados;
- [ ] camada de persistência/domínio mínima implementada quando necessária;
- [ ] testes de criação, leitura, atualização/versionamento e transições aplicáveis;
- [ ] testes negativos de invariantes;
- [ ] lint/test/build verdes;
- [ ] PostgreSQL migration contract verde;
- [ ] documentação atualizada;
- [ ] CI verde;
- [ ] nenhuma Empresa/Filial/Usuário/Membership/Auth/RBAC/RLS/Auditoria antecipada.

## Critério de promoção

Somente após todos os quality gates:

```text
008 = CONCLUDED
009 — Empresa = ACTIVE
```

Até lá:

```text
009 = NOT ACTIVE
G2 = NOT APPROVED
```

## Próxima unidade de trabalho

Executar um **DELTA AUDIT curto da fase 008** e desenhar a migration `0002_tenant.sql` a partir do contrato canônico, começando pelo modelo relacional e lifecycle antes de escrever código.