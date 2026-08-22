# 005 — Secrets Management

## Estado

`ACTIVE`

Dependência satisfeita: `003 — Ambientes`.

A fase 004 foi concluída na revisão canônica `fa5acc3082a8eac7ea2e33d2202a1769859c90a8`, com Production Promotion aprovado e evidence íntegra.

## Objetivo

Separar completamente secrets de código e configuração comum, mantendo segregação por ambiente, menor privilégio, rotação, auditoria e fail-closed.

## Controles implementados nesta fase

- `.gitignore` corporativo para dotenv, chaves privadas, credential files e diretórios locais de secrets;
- `.env.example` com somente nomes de contrato e valores vazios;
- política `docs/security/SECRETS-POLICY.md` ampliada com classificação, stores, segregação, rotação, auditoria e resposta a incidente;
- contrato explícito entre `secrets`, `vars` e credenciais efêmeras;
- teste automatizado que rejeita arquivos secretos rastreados e valores preenchidos no `.env.example`;
- manutenção do consumo de `VERCEL_TOKEN` por GitHub Environment, sem persistência no repositório;
- modelo seguro de evidência administrativa definido em `docs/implementation/005-secrets-evidence-model.md`.

## Inventário lógico atual

| Escopo | Nome | Classificação | Estado de consumo |
|---|---|---|---|
| staging | `VERCEL_TOKEN` | secret | consumido e mascarado pela cadeia canônica |
| staging | `VERCEL_ORG_ID` | public config/var | consumido |
| staging | `VERCEL_STAGING_PROJECT_ID` | public config/var | consumido |
| production | `VERCEL_TOKEN` | secret | consumido e mascarado pela cadeia canônica |
| production | `VERCEL_ORG_ID` | public config/var | consumido |
| production | `VERCEL_PRODUCTION_PROJECT_ID` | public config/var | consumido |
| workflow job | `GITHUB_TOKEN` | ephemeral credential | emitido pela plataforma, permissions mínimas |
| fase 006 | `DATABASE_URL` | secret | reservado; ainda não ativado |

## Evidências já disponíveis

A cadeia 004 demonstrou que `VERCEL_TOKEN` é resolvido em jobs vinculados aos environments `staging` e `production`, com valor mascarado nos logs e falha fechada se ausente. Nenhum valor secreto foi persistido nos artifacts de evidência.

A auditoria da fase 005 também comprovou a existência dos environments `staging` e `production` e suas regras de proteção. A integração disponível, porém, não possui permissão administrativa suficiente para listar a metadata dos environment secrets.

## Limitação administrativa conhecida

A API do GitHub Actions Secrets não retorna valores secretos; endpoints de leitura retornam apenas metadata, como nome, `created_at` e `updated_at`. Portanto, comparar valores de `staging` e `production` não é um mecanismo de auditoria permitido nem tecnicamente necessário.

A tentativa com a integração atual de consultar a metadata administrativa de environment secrets retornou `403 Resource not accessible by integration` em `staging` e `production`. Essa limitação deve ser registrada, não contornada por exposição ou exfiltração do secret.

A independência entre ambientes deve ser comprovada por metadata/processo administrativo seguro, conforme `005-secrets-evidence-model.md`, por exemplo:

- IDs/labels distintos de credenciais no provider;
- provisionamento/rotação independente documentado por environment;
- metadata de criação/atualização combinada com registro administrativo;
- workload identity/OIDC com scopes/subjects distintos por environment.

## Gate de conclusão

Para marcar 005 como `CONCLUDED`, todos os itens abaixo devem ser verdadeiros:

- [x] nenhum secret operacional em código/repositório;
- [x] dotenv real e credential files bloqueados por política/CI;
- [x] secret store por environment definido;
- [x] `secrets` separados de `vars`;
- [x] logs/evidências sem valores secretos;
- [x] política de rotação/revogação definida;
- [x] modelo seguro de evidência administrativa definido sem comparação de valores secretos;
- [ ] evidência administrativa de credenciais independentemente provisionadas/rotacionadas por ambiente;
- [ ] evidência administrativa/auditável de controle de acesso e última rotação dos secrets existentes.

Enquanto os dois itens administrativos finais não forem comprovados, o estado correto permanece `005 = ACTIVE` e `006 = NOT ACTIVE`.

## Regra de segurança da evidência

Nunca usar como evidência de segregação:

- valor do secret;
- hash calculado a partir do valor para comparação entre ambientes;
- screenshot exibindo o valor;
- exportação/cópia do secret para outro sistema.

A evidência deve ser baseada em metadata, identidade não sensível da credencial, escopo, owner, timestamps, audit log e processo de rotação.

## Restrições

Nenhuma migration ou alteração de banco faz parte da fase 005. `DATABASE_URL` permanece apenas como nome de contrato reservado para a fase 006.
