# Ambientes — Moventra TMS

## Objetivo
Padronizar a separação de ambientes de aplicação, banco, secrets e integrações do Moventra TMS.

## Matriz oficial

| Ambiente | Finalidade | Banco Neon | Aplicação / deploy | Dados reais | Estado auditado em 2026-08-22 |
|---|---|---|---|---|---|
| Development | desenvolvimento diário | branch `development` | ambiente de aplicação dedicado ainda não formalmente evidenciado | proibidos por padrão | banco provisionado; aplicação dedicada pendente |
| Test | testes automatizados/efêmeros | branch efêmera ou banco isolado | GitHub Actions / execução efêmera | proibidos | CI automatizado operacional |
| Staging | homologação técnica, gates de release e futura UAT | branch `staging` | Vercel `moventra-tms-staging` (`prj_4USELVoAr0FsHg2vBNGXws7hU22Q`) | mascarados/sintéticos por padrão | provisionado e fisicamente validado |
| Production | operação real | branch `main` | Vercel `moventra-tms` (`prj_5qFenjyeGE1joaGomaNrUIRGSBQs`) | permitidos sob controles LGPD | provisionado; deployment físico da revisão auditada validado; nova execução da 004 requerida após correção do smoke |

> No Vercel, staging e production são projetos separados. Deployments do projeto de staging podem aparecer com `target=production` dentro daquele projeto sem significar promoção para o projeto produtivo do Moventra.

## Regras obrigatórias

- credenciais são exclusivas por ambiente;
- integrações externas devem usar sandbox quando disponível fora de produção;
- produção não deve compartilhar tokens, chaves ou bancos com ambientes inferiores;
- migrations devem ser validadas em branch temporária/isolada antes de alcançar a branch produtiva do banco;
- logs devem evitar dados pessoais desnecessários e nunca conter secrets;
- testes automatizados nunca devem depender de produção;
- artefatos promovidos entre staging e production devem preservar identidade de revisão e integridade;
- alterações de ambiente produtivo devem ser auditáveis e sujeitas aos gates definidos em `004 — CI/CD`.

## Evidência física da revisão auditada

Revisão canônica investigada:

```text
4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

O alias de staging serviu `HTTP 200` com a revisão exata. O projeto produtivo também recebeu fisicamente o mesmo artifact por `Moventra Production Promotion` run `32581944193`, correlacionado ao deployment:

```text
dpl_HCh9jAeUNvD3FeSkeLB8TP48wkVv
```

O run produtivo, contudo, terminou em `failure` depois do deploy porque o smoke do alias protegido por Vercel Authentication excedeu `ARG_MAX` ao transportar uma página SSO grande por variável de ambiente. O defeito foi corrigido e coberto por testes, mas a 004 exige nova execução integralmente bem-sucedida antes de ser concluída.

Detalhes:

```text
docs/implementation/004-production-promotion-remediation-2026-08-22.md
```

## Estado do banco

O projeto Neon oficial é `moventra-tms`, PostgreSQL 18.6, com branches `main`, `development` e `staging`.

Na verificação somente leitura da branch Neon `main` em 2026-08-22:

```text
organization schema = absent
identity schema     = absent
audit schema        = absent
foundation tables   = 0
```

Portanto, `db/migrations/0001_foundation.sql` permanece preparada no repositório, mas não aplicada ao Neon `main`.

## Gates relacionados

```text
004 = IN PROGRESS / REMEDIATED / REEXECUTION REQUIRED
005 = NOT ACTIVE
006 = NOT ACTIVE
G1  = NOT APPROVED
```

A sequência oficial não deve ser antecipada.
