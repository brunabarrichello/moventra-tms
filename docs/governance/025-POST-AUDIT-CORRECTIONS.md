# Gate pós-auditoria da fase 025 — Correções 1–14

## Objetivo

Reconciliar a baseline 025 antes de qualquer progressão operacional da fase 026 — DLQ.

Artefatos 026 que tenham entrado antecipadamente em source control são tratados como **PREPARED** e não autorizam migration/deploy enquanto este gate estiver aberto.

## Correções

| # | Correção | Estado | Evidência / decisão |
|---:|---|---|---|
| 1 | Revision Identity Worker | **RESOLVED / PRODUCTION VALIDATED** | `runtimeVersion()` reconhece `MOVENTRA_RELEASE_SHA`; hardening `3d0ac786...` |
| 2 | `IMPLEMENTATION-ORDER.md` | **IMPLEMENTED / AWAITING CI** | linha canônica sincronizada com 001–025 e migrations Production 0001–0016 |
| 3 | `README.md` | **IMPLEMENTED / AWAITING CI** | runtime Vercel/Railway, RabbitMQ e baseline 025 sincronizados |
| 4 | Confluence oficial | **UPDATED** | página `Moventra TMS — Projeto Oficial` congelada em baseline 025 durante o gate |
| 5 | `.env.example` | **IMPLEMENTED / AWAITING CI** | Messaging, Jobs, Outbox, release identity e OTLP sem valores reais |
| 6 | PR #109 | **SUPERSEDE AFTER THIS PR EXISTS** | conteúdo válido incorporado no contrato consolidado |
| 7 | CI completo | **PENDING PR EVIDENCE** | executar workflows obrigatórios + Security CI |
| 8 | Smoke real Production | **PENDING REVALIDATION** | revalidar Vercel health/readiness e Worker Railway sem promover 026 |
| 9 | Dependency vulnerability gate | **IMPLEMENTED / AWAITING CI** | `npm audit --audit-level=high --omit=dev` em Security CI |
| 10 | SAST inicial | **IMPLEMENTED / AWAITING CI** | CodeQL JavaScript/TypeScript, action pinada por SHA |
| 11 | Polling Worker | **IMPLEMENTED / AWAITING CI** | backoff adaptativo de idle, teto bounded e reset após trabalho |
| 12 | Postura de rede Neon | **DECIDED** | `ADR-0003-neon-network-security.md`; risco time-bounded antes de dados sensíveis |
| 13 | Legado Atlassian `MP-*` | **RECONCILED** | páginas antigas rotuladas `LEGADO MP`; arquitetura/roadmap antigos também saneados |
| 14 | Jira `MVT` | **DECIDED / DEFERRED** | GitHub permanece fonte de execução; MVT reservado até cutover formal |

## Condição de fechamento

O gate só muda para `CONCLUDED` quando:

1. PR de hardening estiver verde nos checks obrigatórios;
2. alterações forem integradas em `main`;
3. CI de `main` permanecer verde;
4. smoke Production comprovar que a baseline 025 continua saudável;
5. não houver `0017_dlq.sql` aplicada no banco Production durante o gate;
6. Confluence e GitHub estiverem sincronizados.

## Regra de segurança

Nenhum valor de secret/credential deve ser registrado neste documento, em PR, issue, log ou evidência. Somente nomes de variáveis e identificadores não sensíveis são permitidos.

## Transição posterior

Após o fechamento do gate, a fase 026 pode ser liberada formalmente como `ACTIVE`. Isso não equivale à conclusão da 026: migrations, Staging, rollback/restore, approval humano de Production e smoke próprios continuam obrigatórios.
