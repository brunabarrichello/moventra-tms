# 006 — B006-02 — Fresh prebuilt deployment checkpoint

## Contexto

A credencial de runtime de staging foi corrigida administrativamente no Neon/Vercel sem exposição de segredo no repositório, logs ou documentação.

O Vercel rejeita `Redeploy` para deployments criados a partir de artefatos prebuilt quando a intenção é consumir Environment Variables/Project Settings atualizados. O comportamento esperado é criar um novo deployment.

## Decisão

Preservar o fluxo oficial de artefato imutável do Moventra:

1. produzir uma nova revisão legítima na `main`;
2. executar `Moventra CI`;
3. produzir um novo artefato imutável;
4. deixar o `Moventra Release Gate` criar um novo deployment prebuilt de staging;
5. validar `/health` e `/database-health` no novo deployment;
6. somente considerar staging concluído quando `/database-health` retornar HTTP 200 com `status=ready`.

Não usar `Redeploy` de deployment prebuilt como evidência de atualização de Environment Variables.

## Segurança

Nenhum valor de `DATABASE_URL`, senha, hash, prefixo ou connection string deve ser registrado. A evidência aceita continua sendo exclusivamente operacional e sanitizada.

## Estado

```text
006 = ACTIVE / B006-02 STAGING FRESH DEPLOYMENT REQUIRED
007 = NOT ACTIVE
G1  = NOT APPROVED
```
