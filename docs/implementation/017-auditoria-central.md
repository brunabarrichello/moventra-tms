# 017 — Auditoria Central

## Estado

`ACTIVE / FINAL PHASE DO BATCH 012–017`

Após o gate técnico desta fase, o batch completo segue para a única promoção Production autorizada.

## Objetivo

Fornecer trilha central, append-only e consultável para decisões de segurança, alterações administrativas e ações críticas, mantendo separação entre Audit Trail, logs operacionais e futuros ledgers Financeiro/Fiscal.

## Modelo

`audit.audit_events` é explicitamente tenant-scoped e registra:
- `tenant_id` obrigatório em todos os eventos;
- contexto Empresa/Filial quando aplicável;
- ator User/Membership quando conhecido;
- `category`, `action`, entidade e resultado;
- request/correlation IDs e motivo;
- before/after/metadata estruturados, minimizados e redigidos;
- timestamp imutável.

Eventos administrativos verdadeiramente globais não são representados por `tenant_id = NULL` nesta tabela. Se essa necessidade surgir, deverá existir um agregado de auditoria administrativa separado, com autorização e política de acesso próprias, sem enfraquecer o isolamento SaaS da trilha tenant-scoped.

## Imutabilidade

UPDATE e DELETE são bloqueados por trigger. O repository expõe somente `append`. Correções posteriores devem gerar novos eventos, nunca reescrever histórico.

## Segurança e LGPD

- passwords, secrets, credentials, tokens, cookies, authorization headers, private keys e DATABASE_URL são redigidos antes da persistência;
- payloads têm limite de tamanho e profundidade;
- coletar somente dados necessários à finalidade da auditoria;
- PII não deve ser copiada integralmente por conveniência;
- todos os eventos usam `tenant_id NOT NULL` e a RLS da fase 016;
- o Tenant é derivado do contexto autorizado da requisição/transação, nunca de input não confiável do cliente;
- consultas tenant-scoped não possuem caminho legítimo para acessar eventos de outro Tenant.

## Coerência organizacional

- `actor_membership_id`, quando informado, é validado por FK composta `(tenant_id, actor_membership_id)`;
- Empresa é validada por `(tenant_id, company_id)`;
- Filial é validada por `(tenant_id, company_id, branch_id)`;
- Filial exige Empresa no mesmo Tenant.

## Atomicidade

Chamadores devem injetar a mesma conexão/transação de banco usada na mutação de negócio quando o evento precisa ser atomicamente consistente com a alteração auditada. O evento de auditoria deve fazer commit ou rollback junto com a mutação correspondente quando representar o resultado daquela transação.

## Gate final do batch

Após CI e Neon Staging verdes:
1. promover migrations pendentes 0007–0011 para Neon Main, em ordem e com checksums imutáveis;
2. validar banco final;
3. validar Staging na revisão final;
4. executar a promoção protegida única para Production;
5. comprovar revision identity, `/health`, `/api/database-health` e ausência de erros runtime;
6. concluir 012→017 em ordem e reavaliar `G2 — Security Ready`.
