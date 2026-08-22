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
- manutenção do consumo de `VERCEL_TOKEN` por GitHub Environment, sem persistência no repositório.

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

## Limitação administrativa conhecida

A conexão GitHub disponível neste projeto não expõe administração/listagem de repository/environment secrets. Portanto, a fase 005 não deve tentar ler ou exibir valores secretos para provar conformidade.

A distinção de **valores** entre `staging` e `production`, bem como metadata de última rotação/acesso, precisa ser comprovada pelo painel administrativo/audit log do provedor ou por uma futura integração que exponha apenas metadata segura.

## Gate de conclusão

Para marcar 005 como `CONCLUDED`, todos os itens abaixo devem ser verdadeiros:

- [x] nenhum secret operacional em código/repositório;
- [x] dotenv real e credential files bloqueados por política/CI;
- [x] secret store por environment definido;
- [x] `secrets` separados de `vars`;
- [x] logs/evidências sem valores secretos;
- [x] política de rotação/revogação definida;
- [ ] evidência administrativa de que os valores de secrets são distintos entre ambientes;
- [ ] evidência administrativa/auditável de controle de acesso e rotação dos secrets existentes.

Enquanto os dois itens administrativos finais não forem comprovados, o estado correto permanece `005 = ACTIVE` e `006 = NOT ACTIVE`.

## Restrições

Nenhuma migration ou alteração de banco faz parte da fase 005. `DATABASE_URL` permanece apenas como nome de contrato reservado para a fase 006.
