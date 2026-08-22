# 005 — Secrets Management

## Estado

`CONCLUDED`

Dependência satisfeita: `004 — CI/CD`.

A fase 005 foi concluída após validação administrativa e operacional do cutover de secrets por ambiente. A conclusão preserva uma exceção de risco explicitamente aceita pelo responsável: o token Vercel legado compartilhado permanece ativo e não é utilizado como credencial-alvo dos GitHub Environments atuais.

## Objetivo

Separar secrets de código e configuração comum, mantendo segregação por ambiente, menor privilégio, rotação, auditoria e comportamento fail-closed.

## Controles implementados

- `.gitignore` corporativo para dotenv, chaves privadas, credential files e diretórios locais de secrets;
- `.env.example` apenas com nomes de contrato e valores vazios;
- política `docs/security/SECRETS-POLICY.md` com classificação, stores, segregação, rotação, auditoria e resposta a incidente;
- contrato explícito entre `secrets`, `vars` e credenciais efêmeras;
- CI rejeitando arquivos secretos rastreados e valores preenchidos no `.env.example`;
- `VERCEL_TOKEN` consumido somente a partir de GitHub Environments;
- modelo seguro de evidência administrativa em `docs/implementation/005-secrets-evidence-model.md`;
- credenciais Vercel dedicadas e escopadas por projeto para `staging` e `production`;
- expiração finita para as credenciais dedicadas;
- `production` com approval protegido, prevenção de autoaprovação e bypass administrativo removido conforme confirmação administrativa.

## Evidência operacional final

Revisão canônica validada: `988bb4b40f863361ba4a2bc8ffb3d26a1aa1d6c1`.

A cadeia canônica pós-cutover comprovou:

- Foundation CI e Moventra CI aprovados;
- build de artefato imutável aprovado;
- deployment de staging pós-cutover em estado `READY`;
- smoke/revision identity de staging aprovado;
- rollback drill concluído com novas revisões de staging em estado `READY`;
- Production Promotion protegida concluída;
- deployments de production pós-cutover em estado `READY`;
- health de staging retornando HTTP 200 e a revisão canônica;
- health de production retornando HTTP 200 e a mesma revisão canônica;
- nenhum valor secreto persistido em repositório, documentação, issues ou artifacts de governança.

## Exceção de risco aceita — token legado Vercel

O responsável decidiu manter ativo o token Vercel legado compartilhado, originalmente de escopo amplo e sem expiração, apesar da recomendação de revogação.

Tratamento de governança:

- risco explicitamente aceito pelo responsável em 22/08/2026;
- a permanência do token legado não altera as credenciais-alvo dos GitHub Environments;
- `staging` e `production` foram validados operacionalmente com credenciais dedicadas por projeto;
- o token legado não deve ser reintroduzido nos GitHub Environments atuais;
- nenhuma cópia, valor, hash ou fragmento do token deve ser persistido em documentação, issues, logs ou artifacts;
- a revogação futura permanece recomendada como hardening, mas não bloqueia a continuidade por decisão explícita de risco.

## Gate de conclusão

- [x] nenhum secret operacional versionado;
- [x] dotenv real e credential files bloqueados por política/CI;
- [x] secret store segregado por environment;
- [x] `secrets` separados de `vars`;
- [x] logs/evidências sem valores secretos;
- [x] política de rotação/revogação definida;
- [x] modelo seguro de evidência administrativa;
- [x] credenciais independentes por ambiente/projeto;
- [x] controle administrativo e metadata de atualização/escopo comprovados;
- [x] cutover operacional validado pela cadeia canônica;
- [x] exceção do token legado formalmente registrada como risco aceito.

## Promoção oficial

```text
005 = CONCLUDED
006 = ACTIVE
```

A próxima fase oficial é `006 — Banco Base`.
