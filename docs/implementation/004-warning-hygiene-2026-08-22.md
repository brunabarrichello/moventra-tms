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
- `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` — v8.0.1;
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` — v7.0.1.

Todos os pins acima utilizam runtime `node24` no próprio metadata da Action.

O `setup-node` permanece em v6.5.0 deliberadamente para evitar adotar uma linha mais nova enquanto houver advisory upstream relevante em avaliação. O cache automático do package manager é explicitamente desabilitado com `package-manager-cache: false`, evitando mudança implícita de comportamento.

### npm/npx — deprecation noise do Vercel CLI

Os scripts de release agora executam o Vercel CLI com:

```text
NPM_CONFIG_LOGLEVEL=error
VERCEL_TELEMETRY_DISABLED=1
```

Isso remove apenas mensagens de warning/deprecation do instalador npm/npx e telemetry. Erros do próprio Vercel continuam sendo capturados, exibidos e propagados por exit code.

Não foi adicionado `2>/dev/null` ao Vercel CLI e nenhum `|| true` foi introduzido no deploy.

## Regressão automatizada

`tests/integration/workflow-runtime-hygiene.test.js` garante:

1. ausência dos pins antigos Node.js 20;
2. pins de Actions por SHA completo;
3. uso exato das revisões aprovadas;
4. `package-manager-cache: false` em cada setup-node;
5. presença de `NPM_CONFIG_LOGLEVEL=error` e `VERCEL_TELEMETRY_DISABLED=1` nos scripts Vercel;
6. proibição de descarte do stderr do Vercel por redirecionamento para `/dev/null`.

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
004 = IN PROGRESS / WARNING HYGIENE REMEDIATION
005 = NOT ACTIVE
006 = NOT ACTIVE
G1  = NOT APPROVED
G2  = NOT APPROVED
```
