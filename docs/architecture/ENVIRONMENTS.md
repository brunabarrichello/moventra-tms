# Ambientes — Moventra TMS

## Objetivo
Padronizar a separação de ambientes de aplicação, banco, secrets e integrações do Moventra TMS.

## Matriz oficial

| Ambiente | Finalidade | Banco Neon | Aplicação / deploy | Dados reais | Estado auditado em 2026-08-22 |
|---|---|---|---|---|---|
| Development | desenvolvimento diário | branch `development` | ambiente de aplicação dedicado ainda não formalmente evidenciado | proibidos por padrão | banco provisionado; aplicação dedicada pendente |
| Test | testes automatizados/efêmeros | branch efêmera ou banco isolado | GitHub Actions / execução efêmera | proibidos | CI automatizado operacional |
| Staging | homologação técnica, gates de release e futura UAT | branch `staging` | Vercel `moventra-tms-staging` (`prj_4USELVoAr0FsHg2vBNGXws7hU22Q`) | mascarados/sintéticos por padrão | provisionado e fisicamente validado |
| Production | operação real | branch `main` | Vercel `moventra-tms` (`prj_5qFenjyeGE1joaGomaNrUIRGSBQs`) | permitidos sob controles LGPD | provisionado; deployment físico da revisão atual validado |

> Observação: no Vercel, staging e production são projetos separados. Por isso deployments do projeto de staging podem aparecer com `target=production` dentro daquele projeto sem significar promoção para o projeto produtivo do Moventra.

## Regras obrigatórias

- credenciais são exclusivas por ambiente;
- integrações externas devem usar sandbox quando disponível fora de produção;
- produção não deve compartilhar tokens, chaves ou bancos com ambientes inferiores;
- migrations devem ser validadas em branch temporária/isolada antes de alcançar a branch produtiva do banco;
- logs devem evitar dados pessoais desnecessários e nunca conter secrets;
- testes automatizados nunca devem depender de produção;
- artefatos promovidos entre staging e production devem preservar identidade de revisão e integridade;
- alterações de ambiente produtivo devem ser auditáveis e sujeitas aos gates definidos em `004 — CI/CD`.

## Evidência física atual

Revisão canônica da aplicação em `main` na auditoria:

```text
4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

O alias estável de staging respondeu `HTTP 200` com:

```text
status=ok
product=Moventra TMS
service=moventra-api
version=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

O alias estável de production também respondeu `HTTP 200` com a mesma revisão:

```text
status=ok
product=Moventra TMS
service=moventra-api
version=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

A presença física da revisão em produção não substitui a evidência formal de approval e correlação do workflow exigida para concluir a fase 004.

## Estado do banco

O projeto Neon oficial é `moventra-tms`, PostgreSQL 18.6, com branches `main`, `development` e `staging`.

Na verificação somente leitura da branch Neon `main` em 2026-08-22:

```text
organization schema = absent
identity schema     = absent
audit schema        = absent
foundation tables   = 0
```

Portanto, `db/migrations/0001_foundation.sql` permanece **preparada no repositório, mas não aplicada ao Neon main**. A etapa 006 — Banco Base continua pendente e não deve ser antecipada enquanto a etapa 004 não estiver formalmente encerrada e a 005 não tiver sido promovida conforme a sequência oficial.

## Gate relacionado

`G1 — Foundation Ready` permanece **NOT APPROVED** até que, além dos ambientes e CI/CD, o banco base esteja versionado e aplicado/validado conforme a etapa 006 e os secrets estejam formalmente governados pela etapa 005.
