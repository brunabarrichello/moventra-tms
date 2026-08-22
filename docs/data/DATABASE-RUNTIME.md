# Moventra TMS — PostgreSQL Runtime

## Decisão

O runtime da aplicação usa `pg` (node-postgres) encapsulado em `src/infrastructure/database/postgres.js`.

No deploy atual em Vercel, Fluid Compute é habilitado e o pool é registrado com `attachDatabasePool` de `@vercel/functions`, permitindo que conexões TCP ociosas sejam gerenciadas antes da suspensão da função.

O domínio não importa `pg`, `@vercel/functions` ou módulos de infraestrutura.

## Conexões

Existem dois contratos distintos:

1. **Runtime**: usar connection string Neon pooled quando executado em ambiente de alta concorrência/serverless.
2. **Migrations**: usar conexão direta, pois migrations podem exigir semântica que não deve depender de PgBouncer.

Ambos são expostos à aplicação por `DATABASE_URL` no secret store do ambiente, nunca no repositório.

## Pool

Defaults iniciais:

- `DB_POOL_MAX=5`;
- `DB_POOL_IDLE_TIMEOUT_MS=10000`;
- `DB_CONNECTION_TIMEOUT_MS=5000`.

Os valores são limites iniciais conservadores. Alterações devem ser baseadas em telemetria, limites do Neon e perfil real de concorrência.

## Transações

`withDatabaseTransaction(callback)` oferece a fronteira transacional de infraestrutura:

- obtém um client dedicado;
- executa `BEGIN`;
- executa o callback;
- executa `COMMIT` em sucesso;
- tenta `ROLLBACK` em falha;
- sempre devolve o client ao pool.

Regras de domínio e casos de uso não devem abrir conexão diretamente.

## Queries

`queryDatabase(text, values)` recebe SQL e parâmetros separadamente. Código de aplicação deve usar parâmetros posicionais do PostgreSQL e nunca interpolar entrada não confiável em SQL.

## Readiness

`checkDatabaseReadiness()` valida conectividade e exige PostgreSQL 18+.

O endpoint `/health` continua sendo liveness do processo e não deve depender do banco. Um endpoint de readiness pode usar `checkDatabaseReadiness()` quando a configuração de ambiente e o artefato de aplicação passarem a incluir dependências de banco.

## Segurança

- não logar `DATABASE_URL`;
- não logar senha, token ou connection string;
- `DATABASE_URL` deve existir somente em secret store;
- runtime deve usar role de aplicação com menor privilégio, distinta da role administrativa usada para migrations;
- migrations em production não devem ser executadas pela role de runtime;
- pool e timeouts devem ser finitos;
- erros enviados a clientes não devem conter host, usuário, SQL completo ou detalhes de credenciais.

## Portabilidade

`pg` fica restrito à infraestrutura. Se o provedor PostgreSQL mudar no futuro, casos de uso e domínio não devem precisar conhecer detalhes de Neon ou Vercel.
