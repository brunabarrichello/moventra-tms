# RISK-005 — Token Vercel legado mantido ativo

## Estado

`ACCEPTED`

## Contexto

Durante a fase `005 — Secrets Management`, staging e production foram migrados para credenciais Vercel dedicadas, escopadas por projeto e com expiração finita. O token legado compartilhado, de escopo amplo e sem expiração, permaneceu disponível no provedor.

## Decisão

Em 22/08/2026, o responsável pelo projeto decidiu manter o token legado ativo e solicitou continuidade automática do projeto sem usar sua revogação como bloqueio da fase 005.

## Risco

A existência de uma credencial antiga com escopo mais amplo aumenta a superfície de ataque e pode permitir acesso superior ao necessário caso seja comprometida.

## Controles compensatórios

- GitHub Environments `staging` e `production` utilizam credenciais dedicadas por projeto;
- os fluxos pós-cutover foram validados ponta a ponta em staging e production;
- production mantém approval protegido e prevenção de autoaprovação;
- nenhum valor secreto deve ser registrado no repositório, issues, logs ou artifacts;
- o token legado não deve voltar a ser usado pelos pipelines atuais;
- revisão periódica e revogação futura permanecem recomendadas.

## Impacto na governança

A decisão é uma aceitação explícita de risco, não uma declaração de que o token legado é a configuração recomendada. Com os controles compensatórios validados, a exceção não bloqueia a promoção `005 = CONCLUDED` e `006 = ACTIVE`.
