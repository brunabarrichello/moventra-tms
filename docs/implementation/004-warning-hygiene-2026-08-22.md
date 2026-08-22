# 004 — Warning Hygiene Remediation — 2026-08-22

## Escopo

Esta remediação pertence exclusivamente à fase **004 — CI/CD**. Não ativa a fase 005 e não altera secrets, banco de dados, migrations, regras de negócio ou configuração de tenants.

## Objetivo

Eliminar warnings conhecidos da cadeia canônica sem ocultar falhas reais, mantendo:

- actions de terceiros/GitHub pinadas por SHA completo;
- runtime Node.js 24 para as GitHub Actions utilizadas;
- runtime da aplicação Moventra em Node.js 22;
- deploy e smoke tests fail-closed;
- stderr operacional do Vercel preservado;
- evidências e retenção existentes.

## Warnings tratados

### GitHub Actions — Node.js 20 deprecated

Pins retirados:

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`;
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`;
- `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`;
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`.

Pins aprovados:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` — v7.0.1;
- `actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38` — v6.5.0;
- `actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131` — v7.0.0;
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` — v7.0.1.

Todos os pins aprovados utilizam runtime `node24` no metadata da Action.

O `setup-node` permanece em v6.5.0 deliberadamente para evitar adotar uma linha mais nova enquanto houver advisory upstream relevante em avaliação. O cache automático do package manager é explicitamente desabilitado com `package-manager-cache: false`, evitando mudança implícita de comportamento.

### download-artifact v8 — `DEP0005 Buffer()`

A primeira execução canônica após a migração para runtimes Node 24 mostrou que `actions/download-artifact` v8.0.1, embora execute em Node 24, emite no GitHub-hosted runner:

```text
[DEP0005] DeprecationWarning: Buffer() is deprecated
```

Para a cadeia Moventra, o pin aprovado foi recuado deliberadamente para `actions/download-artifact` v7.0.0 (`37930b1c2abaa49bbe596cd826c3c89aef350131`). Essa release já usa Node.js 24 e suporta os inputs necessários ao Release Gate, Rollback Drill e Production Promotion.

O pin v8.0.1 `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` é tratado como warning-producing e rejeitado pelos testes de higiene até nova validação canônica.

### npm/npx e Vercel CLI

Os scripts de release agora fixam Vercel CLI `59.4.0` e executam o CLI com:

```text
NPM_CONFIG_LOGLEVEL=error
NO_UPDATE_NOTIFIER=1
VERCEL_TELEMETRY_DISABLED=1
```

Isso remove mensagens de warning/deprecation do instalador npm/npx, banners de atualização e telemetry. Erros do próprio Vercel continuam sendo capturados, exibidos e propagados por exit code.

Não foi adicionado `2>/dev/null` ao Vercel CLI e nenhum `|| true` foi introduzido no deploy.

## Regressão automatizada

`tests/integration/workflow-runtime-hygiene.test.js` garante:

1. ausência dos pins antigos Node.js 20;
2. ausência do pin `download-artifact` v8.0.1 que produziu `DEP0005` na cadeia canônica;
3. pins de Actions por SHA completo;
4. uso exato das revisões aprovadas;
5. `package-manager-cache: false` em cada setup-node;
6. presença de `NPM_CONFIG_LOGLEVEL=error`, `NO_UPDATE_NOTIFIER=1` e `VERCEL_TELEMETRY_DISABLED=1` nos scripts Vercel;
7. proibição de descarte do stderr do Vercel por redirecionamento para `/dev/null`.

`tests/integration/release-scripts.test.js` também exige Vercel CLI 59.4.0 e comprova que as variáveis de higiene chegam ao `npx` sem transportar o token em argumentos.

## Critério de aceite

A remediação somente pode ser considerada validada após:

- Foundation CI = success;
- Moventra CI = success;
- lint = success;
- tests = success;
- security baseline = success;
- immutable build = success;
- CI evidence = success;
- ausência dos warnings conhecidos nos novos logs;
- cadeia canônica Release Gate → Rollback Drill → Production Promotion concluída com evidence.

## Estado

```text
004 = IN PROGRESS / WARNING HYGIENE REMEDIATION ROUND 2
005 = NOT ACTIVE
006 = NOT ACTIVE
G1  = NOT APPROVED
G2  = NOT APPROVED
```
