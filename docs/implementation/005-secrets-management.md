# 005 — Secrets Management

## Estado

`ACTIVE / CUTOVER VALIDATION`

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
| staging | `VERCEL_TOKEN` | secret | provisionado no GitHub Environment; cutover operacional em validação |
| staging | `VERCEL_ORG_ID` | public config/var | consumido |
| staging | `VERCEL_STAGING_PROJECT_ID` | public config/var | aponta para projeto Vercel dedicado de staging |
| production | `VERCEL_TOKEN` | secret | provisionado no GitHub Environment; cutover operacional em validação |
| production | `VERCEL_ORG_ID` | public config/var | consumido |
| production | `VERCEL_PRODUCTION_PROJECT_ID` | public config/var | aponta para projeto Vercel dedicado de production |
| workflow job | `GITHUB_TOKEN` | ephemeral credential | emitido pela plataforma, permissions mínimas |
| fase 006 | `DATABASE_URL` | secret | reservado; ainda não ativado |

## Evidências administrativas comprovadas

A auditoria administrativa da fase 005 comprovou, sem leitura ou persistência de valores secretos:

- GitHub Environments `staging` e `production` distintos;
- `VERCEL_TOKEN` armazenado como Environment Secret em ambos;
- metadata de atualização disponível administrativamente;
- branch de deployment restrita a `main` nos dois environments;
- `production` com `Required reviewers` e `Prevent self-review`;
- projetos Vercel distintos para staging e production;
- credencial Vercel dedicada para staging, com scope exclusivo do projeto de staging e expiração finita;
- credencial Vercel dedicada para production, com scope exclusivo do projeto de production e expiração finita;
- independência administrativa das credenciais do provider comprovada por nomes/scopes distintos;
- confirmação administrativa de que os GitHub Environment Secrets foram atualizados para as credenciais dedicadas;
- confirmação administrativa de remoção do bypass de protection rules em `production`.

Nenhum valor secreto integra esta documentação, issues, logs ou artifacts.

## Limitação administrativa conhecida

A API do GitHub Actions Secrets não retorna valores secretos; endpoints de leitura retornam apenas metadata, como nome, `created_at` e `updated_at`. Portanto, comparar valores de `staging` e `production` não é um mecanismo de auditoria permitido nem tecnicamente necessário.

A integração atual também não possui permissão administrativa suficiente para listar toda a metadata de Environment Secrets. Essa limitação é registrada e não deve ser contornada por exposição ou exfiltração do secret.

A independência entre ambientes é comprovada por metadata/processo administrativo seguro, conforme `005-secrets-evidence-model.md`.

## Cutover operacional em validação

A etapa administrativa do cutover foi declarada concluída em 22/08/2026. A conclusão técnica da fase depende agora de evidência produzida pela própria cadeia canônica, sem screenshots:

- [ ] novo `Moventra CI` concluído na `main` após esta revisão de governança;
- [ ] `Moventra Release Gate` concluído com deployment de staging usando o Environment Secret atual;
- [ ] smoke/revision identity de staging aprovado;
- [ ] rollback drill concluído com o artefato imutável promovido;
- [ ] `Moventra Production Promotion` concluído após approval protegido;
- [ ] deployment de production `READY` e revision identity validada;
- [ ] evidência final registrada sem material secreto.

Os workflows canônicos são fail-closed: ausência ou invalidade de `VERCEL_TOKEN`, `VERCEL_ORG_ID` ou project ID encerra a execução com erro.

## Exceção de risco registrada

O responsável pelo projeto optou por manter as duas credenciais dedicadas atualmente provisionadas durante o cutover. A decisão é registrada como risco aceito sem persistir qualquer valor secreto. A política permanente continua exigindo menor privilégio, expiração finita, segregação por ambiente e rotação conforme política corporativa.

## Gate de conclusão

Para marcar 005 como `CONCLUDED`, todos os itens abaixo devem ser verdadeiros:

- [x] nenhum secret operacional em código/repositório;
- [x] dotenv real e credential files bloqueados por política/CI;
- [x] secret store por environment definido;
- [x] `secrets` separados de `vars`;
- [x] logs/evidências sem valores secretos;
- [x] política de rotação/revogação definida;
- [x] modelo seguro de evidência administrativa definido sem comparação de valores secretos;
- [x] credenciais independentemente provisionadas/rotacionadas por ambiente;
- [x] controle administrativo e metadata de atualização/escopo comprovados;
- [ ] cutover operacional validado pela cadeia canônica após atualização dos Environment Secrets.

Enquanto o cutover técnico não for comprovado, o estado correto permanece `005 = ACTIVE / CUTOVER VALIDATION` e `006 = NOT ACTIVE`.

## Regra de segurança da evidência

Nunca usar como evidência de segregação:

- valor do secret;
- hash calculado a partir do valor para comparação entre ambientes;
- screenshot exibindo o valor;
- exportação/cópia do secret para outro sistema.

A evidência deve ser baseada em metadata, identidade não sensível da credencial, escopo, owner, timestamps, audit log, processo de rotação e execução técnica fail-closed.

## Restrições

Nenhuma migration ou alteração de banco faz parte da fase 005. `DATABASE_URL` permanece apenas como nome de contrato reservado para a fase 006.
