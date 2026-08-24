# 011 — Usuários

## Estado

`ACTIVE / DEFINED`

Ativada oficialmente após:

```text
010 — Filial = CONCLUDED
G1 = APPROVED
```

Permanecem:

```text
012 — Memberships = NOT ACTIVE
013 — Auth = NOT ACTIVE
014 — RBAC = NOT ACTIVE
015 — Escopo Organizacional = NOT ACTIVE
016 — RLS / Defesa adicional = NOT ACTIVE
017 — Auditoria Central = NOT ACTIVE
G2 = NOT APPROVED
```

## Objetivo

Materializar **User/Usuário** como identidade humana/de negócio canônica do Moventra TMS, independente de Tenant e independente do provider de autenticação.

A separação arquitetural é obrigatória:

```text
User
  = identidade humana/de negócio canônica

Membership
  = vínculo User ↔ Tenant/Empresa/Filial
  = fase 012

Auth / External Identity
  = vínculo provider + subject / credenciais / sessão
  = fase 013
```

Isso permite que a mesma pessoa participe de múltiplos Tenants futuramente sem duplicar a identidade global e sem usar IDs de Auth0, Clerk, Cognito, Entra ID, Google ou outro provider como PK de domínio.

## Fontes obrigatórias

- `docs/data/DATA-CONVENTIONS.md`;
- `docs/architecture/ADR-0002-tenant-isolation.md`;
- `docs/security/TENANCY-RBAC-AUDIT.md`;
- `docs/foundation/IMPLEMENTATION-ORDER.md`;
- migrations 0001–0004;
- migration framework em `scripts/db/migrate.mjs`.

## Decisão de boundary

`User` é **global ao SaaS**, não tenant-scoped.

Portanto `identity.users` NÃO DEVE possuir:

```text
tenant_id
company_id
branch_id
membership_id
role_id
provider
provider_subject
password_hash
session_id
access_token
refresh_token
```

O isolamento de acesso por Tenant nasce do futuro `Membership`, não de duplicar o User por Tenant.

## Escopo da fase 011

A fase implementará somente a identidade de negócio User e os artefatos necessários para provar suas invariantes:

- schema `identity`;
- tabela `identity.users`;
- identidade técnica UUIDv7;
- e-mail primário canônico e globalmente único;
- nome de exibição;
- locale preferencial opcional;
- timezone pessoal opcional;
- lifecycle explícito;
- timestamps técnicos;
- optimistic locking;
- constraints e índices;
- migration e validation SQL;
- domínio/persistência mínima;
- testes unitários, negativos e de concorrência;
- guardrails arquiteturais contra antecipação de Membership/Auth/RBAC.

## Não escopo

A fase 011 NÃO DEVE criar:

```text
memberships
invitations
external_identities
auth_accounts
passwords
credentials
sessions
refresh_tokens
roles
permissions
role_assignments
RLS policies
audit_logs
```

Também não deve adicionar autorização por Tenant/Empresa/Filial ao repository de User. Essa autorização depende do modelo de Membership, Auth e RBAC das fases seguintes.

## Modelo relacional alvo

Tabela:

```text
identity.users
```

Estrutura recomendada:

| Campo | Regra |
|---|---|
| `id` | `UUID NOT NULL DEFAULT uuidv7()`; PK imutável |
| `primary_email` | e-mail canônico lowercase/trimmed; único global |
| `display_name` | nome de exibição obrigatório |
| `preferred_locale` | BCP 47 shaped opcional; validação sem lista rígida no banco |
| `preferred_timezone` | IANA timezone opcional; validação completa no domínio |
| `status` | lifecycle explícito |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `version` | `BIGINT NOT NULL DEFAULT 1`; optimistic locking |

### E-mail

A aplicação deve normalizar o e-mail para a forma canônica usada pelo produto:

```text
trim
→ lowercase
→ validação sintática razoável
```

Não implementar parser RFC completo no banco. A constraint de banco deve proteger invariantes básicas e a unicidade.

Decisão inicial:

```text
UNIQUE (primary_email)
```

A unicidade global evita duas identidades canônicas para a mesma conta de e-mail. Se no futuro surgirem requisitos empresariais de identidades sem e-mail ou identidades compartilhadas, isso exige ADR/migration própria; não flexibilizar silenciosamente a 011.

### Locale

`preferred_locale` é preferência pessoal de apresentação, não configuração de Tenant. Pode ser `NULL`, permitindo que a UI derive locale de membership/tenant/browser no futuro.

Validação de forma BCP 47 deve ocorrer no domínio; o banco protege somente tamanho/shape básica para evitar lixo evidente.

### Timezone

`preferred_timezone` é preferência pessoal. Pode ser `NULL`.

Hierarquia futura de apresentação pode considerar:

```text
user.preferred_timezone
?? branch/company/tenant effective timezone
?? client/device timezone
```

A 011 não implementa resolução contextual por Membership porque a fase 012 ainda não existe.

## Lifecycle

Estados iniciais:

```text
PENDING
ACTIVE
SUSPENDED
CLOSED
```

Transições:

```text
PENDING   -> ACTIVE | CLOSED
ACTIVE    -> SUSPENDED | CLOSED
SUSPENDED -> ACTIVE | CLOSED
CLOSED    -> terminal
```

Semântica:

- `PENDING`: identidade criada internamente, ainda não liberada como identidade operacional do produto;
- `ACTIVE`: identidade de negócio operacional;
- `SUSPENDED`: suspensão administrativa reversível da identidade global;
- `CLOSED`: encerramento terminal, preservando referências históricas futuras.

`PENDING` não representa convite para Tenant. Convite e vínculo organizacional pertencem à fase 012 e/ou 013 conforme a arquitetura aprovada.

`status` não pode ser alterado por CRUD arbitrário.

## Concorrência

Toda mutação usa optimistic locking:

```text
WHERE id = ?
  AND version = expected_version
SET version = version + 1
```

Transições também devem condicionar o status esperado.

Zero linhas atualizadas deve ser convertido em erro de recurso inexistente ou conflito de versão, sem mascarar concorrência.

## Persistência

Repository inicial esperado:

```text
src/modules/identity/user/user-repository.js
```

Operações mínimas:

```text
create(input)
findById(id)
findByPrimaryEmail(email)
updateProfile(id, input, expectedVersion)
transitionStatus(id, toStatus, expectedVersion)
```

Não adicionar métodos como:

```text
findByTenant(...)
findByBranch(...)
findByProviderSubject(...)
authenticate(...)
assignRole(...)
```

pois pertencem às fases seguintes.

## Domínio

Arquivo esperado:

```text
src/modules/identity/user/user-domain.js
```

Responsabilidades:

- normalizar/validar primary email;
- validar display name;
- normalizar locale opcional;
- validar timezone IANA opcional;
- validar lifecycle/transições;
- expor `isUserOperational`;
- normalizar expected version;
- produzir erros estáveis `MVT_USER_*`.

## Segurança e LGPD

`primary_email` é dado pessoal e deve ser classificado/protegido como PII.

Regras:

- não registrar e-mail completo em logs operacionais sem necessidade;
- não incluir credenciais/secrets na tabela;
- não expor enumeration de usuário por e-mail em APIs públicas futuras;
- UUID não deve ser tratado como segredo;
- alterações futuras de e-mail podem exigir fluxo de verificação no Auth; a 011 implementa somente a identidade de negócio;
- fechamento não deve hard-delete referências históricas futuras;
- anonimização/retention futura deverá conciliar LGPD com obrigações operacionais/fiscais e relações históricas.

## Migration esperada

```text
db/migrations/0005_user.sql
```

Validation SQL:

```text
db/validation/0005_user_validation.sql
```

A migration deve criar somente artefatos da fase 011 e não pode alterar migrations 0001–0004 já aplicadas.

## Testes mínimos

### Domínio

- criação válida inicia `PENDING`;
- e-mail normalizado para lowercase/trim;
- e-mail inválido rejeitado;
- display name inválido rejeitado;
- locale opcional válido/shape inválida;
- timezone IANA opcional válido/inválido;
- lifecycle válido;
- lifecycle inválido;
- `CLOSED` terminal;
- somente `ACTIVE` é operacional;
- expected version positivo.

### Persistência

- create retorna UUID/status/version persistidos;
- conflito de e-mail mapeado para erro de domínio/repository;
- find by id;
- find by normalized email;
- profile update com optimistic locking;
- stale version rejeitada;
- transition status condicionada por id/status/version;
- `CLOSED` não reabre;
- nenhuma query depende de Tenant/Empresa/Filial/provider.

### Banco/arquitetura

- migration 0005 aplica após 0001–0004 em PostgreSQL 18;
- reexecução preserva migration history;
- validation SQL passa;
- `identity.users` existe;
- `id` usa UUIDv7;
- `primary_email` é unique;
- não existem `tenant_id`, `company_id`, `branch_id` em `identity.users`;
- nenhuma tabela de membership/auth/session/RBAC é criada;
- migrations 0001–0004 permanecem imutáveis.

## Quality gates

A fase somente pode ser concluída quando:

- [ ] boundary User vs Membership vs Auth formalizado;
- [ ] modelo global/provider-agnostic revisado;
- [ ] lifecycle formalizado;
- [ ] contrato de e-mail/PII formalizado;
- [ ] migration `0005_user.sql` implementada;
- [ ] validation SQL implementada;
- [ ] migration validada em PostgreSQL 18 após 0001–0004;
- [ ] reexecução/histórico idempotente validado;
- [ ] domínio/persistência implementados;
- [ ] optimistic locking validado;
- [ ] testes negativos aprovados;
- [ ] lint/test/build verdes;
- [ ] PostgreSQL migration contract verde;
- [ ] migration aplicada e validada em Neon Staging/Main;
- [ ] staging runtime validado;
- [ ] rollback/restore validado;
- [ ] protected Production promotion concluída sem bypass;
- [ ] Production revision identity/health/readiness validados;
- [ ] documentação/issue atualizadas;
- [ ] nenhuma fase 012+ antecipada.

## Critério de promoção

Somente após todos os quality gates:

```text
011 = CONCLUDED
012 — Memberships = ACTIVE / DEFINED
```

Até lá:

```text
011 = ACTIVE
012 = NOT ACTIVE
G2 = NOT APPROVED
```

## Próxima unidade de trabalho

Executar DELTA AUDIT da fase 011 contra convenções/segurança existentes e implementar `identity.users`, migration/validation, domínio, repository e testes sem antecipar Memberships/Auth/RBAC/RLS/Auditoria.
