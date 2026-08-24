# 017 — Auditoria Central

## Estado

`ACTIVE / FINAL PHASE DO BATCH 012–017`

Após o gate técnico desta fase, o batch completo segue para a única promoção Production autorizada.

## Objetivo

Fornecer trilha central, append-only e consultável para decisões de segurança, alterações administrativas e ações críticas, mantendo separação entre Audit Trail, logs operacionais e futuros ledgers Financeiro/Fiscal.

## Modelo

`audit.audit_events` registra:
- Tenant e contexto Empresa/Filial quando aplicável;
- ator User/Membership quando conhecido;
- `category`, `action`, entidade e resultado;
- request/correlation IDs e motivo;
- before/after/metadata estruturados, minimizados e redigidos;
- timestamp imutável.

## Imutabilidade

UPDATE e DELETE são bloqueados por trigger. O repository expõe somente `append`. Correções posteriores devem gerar novos eventos, nunca reescrever histórico.

## Segurança e LGPD

- passwords, secrets, credentials, tokens, cookies, authorization headers, private keys e DATABASE_URL são redigidos antes da persistência;
- payloads têm limite de tamanho e profundidade;
- coletar somente dados necessários à finalidade da auditoria;
- PII não deve ser copiada integralmente por conveniência;
- eventos tenant-scoped usam RLS da fase 016;
- eventos globais/sistema com `tenant_id = NULL` exigem caminho administrativo privilegiado e não ficam visíveis a contexto tenant comum.

## Atomicidade

Chamadores devem injetar a mesma conexão/transação de banco usada na mutação de negócio quando o evento precisa ser atomicamente consistente com a alteração auditada.

## Gate final do batch

Após CI e Neon Staging verdes:
1. promover migrations pendentes 0007–0011 para Neon Main, em ordem e com checksums imutáveis;
2. validar banco final;
3. validar Staging na revisão final;
4. executar a promoção protegida única para Production;
5. comprovar revision identity, `/health`, `/api/database-health` e ausência de erros runtime;
6. concluir 012→017 em ordem e reavaliar `G2 — Security Ready`.
