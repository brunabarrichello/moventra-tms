# Moventra TMS — Governança do Release Smoke Database

## 1. Objetivo

Formalizar a credencial PostgreSQL dedicada ao E2E destrutivo de Staging executado pelo `Moventra Release Gate`, separando definitivamente três responsabilidades:

- `DATABASE_URL`: runtime da aplicação/worker, com menor privilégio e RLS;
- `MIGRATIONS_DATABASE_URL`: migration/control plane, exclusivamente para migrations versionadas;
- `RELEASE_SMOKE_DATABASE_URL`: preparação, inspeção e limpeza da fixture de release em Staging.

A separação foi introduzida após o Release Gate #101 comprovar que autenticação JWT, deploy, revision identity, database health e RabbitMQ estavam saudáveis, enquanto o smoke DLQ ainda reutilizava indevidamente a credencial de migrations para DML de fixture.

## 2. Escopo e proibições

`RELEASE_SMOKE_DATABASE_URL`:

- existe somente no GitHub Environment protegido `staging`;
- nunca é sincronizada para Vercel;
- nunca é entregue ao Railway Worker;
- nunca existe no frontend;
- não é uma credencial de Production;
- não pode possuir `SUPERUSER`, `CREATEROLE`, `CREATEDB` ou bypass de RLS;
- não pode criar objetos em schemas de aplicação;
- deve usar TLS com `sslmode=verify-full` explicitamente;
- deve operar apenas sobre o tenant sintético `staging-dlq-smoke` por meio do contexto `moventra.tenant_id`.

Secrets e connection strings reais nunca são registrados em Git, logs, evidências ou documentação.

## 3. Tenant sintético fixo

O E2E usa um tenant de infraestrutura de Staging com código canônico:

`staging-dlq-smoke`

Seu UUID é criado/provisionado uma vez pelo control plane e é referenciado pela credencial de smoke através do contexto de sessão PostgreSQL. O valor do UUID pode ser tratado como metadata operacional, mas a connection string que o transporta continua sendo secret.

O preflight exige que `security.current_tenant_id()` resolva exatamente esse tenant antes de qualquer criação de identidade temporária no Neon Auth.

## 4. Contrato de privilégios

O contrato declarativo vive em `db/runtime/release-smoke-access.sql`.

Princípios:

1. `USAGE` apenas nos schemas necessários ao E2E;
2. `CREATE` revogado em todos os schemas de aplicação;
3. nenhuma autoridade sobre `moventra_meta`, `configuration`, `feature_flags` ou `jobs`;
4. nenhuma capacidade sobre `jobs.system_jobs` ou `dlq.system_entries`;
5. nenhuma função de dispatcher cross-tenant da Outbox;
6. RLS permanece habilitada e é verificada em preflight;
7. o permission catalog (`security.permissions`) permanece somente leitura;
8. Audit é somente leitura para a credencial de fixture.

A credencial existe para validar a cadeia real `Auth → Membership → RBAC → Scope → RLS → DLQ → Outbox/RabbitMQ → Idempotency → Audit`, e não para substituir APIs administrativas do produto.

## 5. Preflight obrigatório

Antes do deploy da revisão candidata e antes de criar usuário efêmero de Auth, o Release Gate executa `scripts/release/preflight-release-smoke-db.mjs`.

O preflight falha fechado quando qualquer item divergir:

- principal não resolvido;
- principal `SUPERUSER`, `CREATEROLE`, `CREATEDB` ou com bypass de RLS;
- `row_security=off`;
- ausência do tenant sintético no contexto atual;
- schema `USAGE` ausente;
- schema `CREATE` presente;
- privilégio de tabela requerido ausente;
- `security.current_tenant_id()` não executável;
- RLS desabilitada em qualquer tabela tenant-scoped usada pelo smoke;
- connection string sem `sslmode=verify-full`.

Somente hashes SHA-256 de identificadores não secretos podem ser enviados à evidência do gate.

## 6. Cleanup governado do Managed Better Auth

O endpoint de autoexclusão `/delete-user` não é assumido como contrato do release smoke. A limpeza do usuário efêmero é feita pelo control plane branch-scoped do Neon Auth.

Configuração protegida de Staging:

- `NEON_API_KEY`: secret;
- `NEON_PROJECT_ID`: var pública;
- `NEON_STAGING_BRANCH_ID`: var pública.

O smoke captura o `auth_user_id` retornado pelo signup/session sem registrá-lo em logs e, no `finally`, solicita sua exclusão pelo endpoint branch-scoped de gerenciamento de usuários. O gate somente produz `status=ok` quando a limpeza retorna sucesso.

Falhas transitórias explicitamente reconhecidas pelo provider podem receber retry limitado. Erros ambíguos de transporte não são repetidos cegamente, evitando operações de controle duplicadas sem reconciliação.

## 7. Evidência e auditoria

O artifact de evidência pode registrar somente:

- hash do principal efetivo;
- hash do session principal;
- hash do tenant sintético;
- `row_security=true`;
- `bypass_rls=false`;
- resultado do preflight;
- resultado do cleanup de Auth;
- resultados funcionais do DLQ E2E.

É proibido registrar:

- `DATABASE_URL`;
- `MIGRATIONS_DATABASE_URL`;
- `RELEASE_SMOKE_DATABASE_URL`;
- `NEON_API_KEY`;
- JWT;
- cookies/sessões;
- senha do usuário efêmero;
- connection strings ou private keys.

## 8. Provisionamento inicial

O provisionamento externo de Staging é uma operação protegida e deve ocorrer sob aprovação explícita:

1. criar role/login PostgreSQL dedicada ao release smoke;
2. confirmar `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB` e ausência de bypass de RLS;
3. escolher/provisionar o UUID fixo do tenant `staging-dlq-smoke`;
4. aplicar `db/runtime/release-smoke-access.sql` usando control plane autorizado;
5. construir a connection string dedicada com TLS `verify-full` e contexto `moventra.tenant_id`;
6. armazenar como GitHub Environment `staging` secret `RELEASE_SMOKE_DATABASE_URL`;
7. armazenar `NEON_API_KEY` somente no mesmo Environment protegido;
8. registrar `NEON_PROJECT_ID` e `NEON_STAGING_BRANCH_ID` como vars públicas;
9. executar o preflight e preservar somente evidência não secreta.

## 9. Critério de aceite

A correção é aceita somente quando:

- CI da PR estiver verde;
- o principal dedicado estiver provisionado em Staging;
- preflight do principal estiver verde;
- `MIGRATIONS_DATABASE_URL` não for consumida pelo smoke DLQ;
- JWT continuar estritamente validado;
- DLQ list/detail respeitar tenant/RBAC/RLS;
- reprocessamento de mensagem receber publisher confirm RabbitMQ;
- replay HTTP for idempotente e não duplicar Audit SUCCESS;
- usuário efêmero do Neon Auth for removido de forma governada;
- Release Gate Staging concluir com sucesso;
- Rollback Drill concluir com sucesso.

Somente depois desses gates a cadeia pode chegar ao ambiente protegido de Production, que continua exigindo aprovação humana separada.
