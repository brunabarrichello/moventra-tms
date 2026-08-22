# 004 — Auditoria de Estado Atual — 2026-08-22

## 1. Objetivo e precedência

Este registro reconcilia a documentação da linha oficial de implantação com o estado físico observado no GitHub, Vercel e Neon em 2026-08-22.

Ele **não altera a sequência 001–180** e não promove artificialmente etapas. Para fatos de execução física da fase 004, este documento substitui os trechos de status que ficaram desatualizados em `004-cicd.md`, `004-rollback-drill.md`, `ENVIRONMENTS.md` e no tracker da issue #5.

Semântica usada:

```text
DEFINED
→ PREPARED
→ IMPLEMENTED
→ EVIDENCED
→ CONCLUDED
```

`CONCLUDED` exige implementação + validação + evidência formal do gate.

---

# 2. Identidade canônica auditada

```text
Produto: Moventra TMS
Nome técnico: moventra-tms
Repositório: brunabarrichello/moventra-tms
Branch canônica: main
SHA auditado: 4575ffefce63b2bc2b75e6e9985a2b30c40b383b
Runtime da fundação: Node.js 22.x
Arquitetura: monólito modular
Banco: Neon PostgreSQL 18.6
```

O repositório foi renomeado de `moventra-github` para `moventra-tms`; qualquer referência antiga deve ser tratada como histórica.

---

# 3. Resumo executivo

| Controle | Estado auditado | Decisão |
|---|---|---|
| Aplicação executável | EVIDENCED | `/health` operacional |
| Lint / static analysis | EVIDENCED | ESLint + actionlint + verificações de arquitetura |
| Testes | EVIDENCED | unitários, arquitetura e integração HTTP |
| Security baseline | EVIDENCED | controles de material sensível e pipeline |
| Build once | EVIDENCED | Build Output API v3 |
| Artifact imutável | EVIDENCED | artifact ligado ao commit + SHA-256 |
| Staging | EVIDENCED | revisão atual servida pelo alias estável |
| Rollback / restore | EVIDÊNCIA FÍSICA OBSERVADA | deployments distintos e alias restaurado à revisão atual |
| Production | EVIDENCED FISICAMENTE | revisão atual servida pelo alias estável de produção |
| Approval protegido | IMPLEMENTADO NO WORKFLOW / CORRELAÇÃO FORMAL PENDENTE | ainda é necessário preservar/evidenciar review autorizado para a execução produtiva |
| Production evidence artifact | IMPLEMENTADO NO WORKFLOW / CORRELAÇÃO FORMAL PENDENTE | precisa ser correlacionado ao deployment produtivo observado |
| Fase 004 | **FORMAL CLOSURE PENDING** | não promover 005 antes da correlação final |
| G1 | **NOT APPROVED** | 006 também permanece pendente |

---

# 4. Pipeline oficial vigente

A cadeia canônica em `main` é:

```text
Moventra CI
→ Moventra Release Gate (staging only)
→ Moventra Rollback Drill
→ Moventra Production Promotion
```

## 4.1 Moventra CI

O workflow implementa:

- contrato do repositório;
- rejeição de `.env` rastreado e materiais de credencial de alto risco;
- ESLint versionado;
- actionlint versionado e com checksum fixo;
- testes;
- security baseline;
- build determinístico;
- artifact imutável `moventra-tms-<commit_sha>`;
- evidence artifact;
- retenção de 90 dias;
- GitHub Actions pinadas por SHA imutável;
- `persist-credentials: false` nos checkouts aplicáveis.

## 4.2 Release Gate

A promoção para staging:

- aceita artifact produzido por CI de `main`;
- baixa exatamente o artifact esperado;
- revalida manifest, SHA, digest e contrato prebuilt;
- não recompila fonte;
- executa deploy prebuilt no projeto de staging;
- exige smoke revision-aware no deployment e no alias estável;
- produz evidence artifact.

## 4.3 Rollback Drill

O drill automático:

- deriva a revisão anterior do pai linear do commit corrente;
- exige artifact anterior não expirado, produzido por CI em `main`;
- valida artifact de rollback e artifact de restauração;
- exige revisões distintas;
- executa rollback real em staging;
- exige `/health.version` igual à revisão anterior;
- restaura a revisão corrente mesmo após determinados erros intermediários;
- exige `/health.version` igual à revisão restaurada;
- produz evidence artifact com retenção de **90 dias**.

A referência antiga de `180 dias` em `004-rollback-drill.md` está desatualizada; o workflow vigente usa 90 dias.

## 4.4 Production Promotion

O workflow produtivo é fail-closed por desenho. Antes de acessar secrets do environment `production`, o preflight exige:

- Rollback Drill bem-sucedido em `main`;
- evidence de rollback/restore com os quatro resultados obrigatórios em `success`;
- artifact restaurado ainda válido e não expirado;
- SHA da evidence igual ao `main` corrente;
- environment `production` existente;
- exatamente uma regra `required_reviewers`;
- pelo menos um reviewer;
- `prevent_self_review=true`.

Após a aprovação protegida, o job:

- consulta o histórico de approvals;
- captura o aprovador real;
- exige aprovador diferente do ator de origem;
- baixa o mesmo artifact validado anteriormente;
- revalida nome, SHA e digest;
- executa deploy sem rebuild;
- exige smoke revision-aware;
- grava evidence final e approval history.

---

# 5. Evidência física de staging

Projeto Vercel:

```text
name=moventra-tms-staging
project_id=prj_4USELVoAr0FsHg2vBNGXws7hU22Q
```

Deployments observados na cadeia atual incluem:

```text
dpl_Daht2kHsut2BNX3wXvnfY7RGzfTR  READY
dpl_Bwvj6K6WYsyAMNXNEUaHUm1Leis4  READY
dpl_8oZfd9JncXu5PJ6xayrBeta312Ck  READY
```

O alias estável respondeu `HTTP 200` durante a auditoria:

```json
{
  "status": "ok",
  "product": "Moventra TMS",
  "service": "moventra-api",
  "version": "4575ffefce63b2bc2b75e6e9985a2b30c40b383b"
}
```

Conclusão:

```text
staging physical deployment = EVIDENCED
staging exact revision       = EVIDENCED
```

---

# 6. Evidência física de rollback / restore

A sequência de staging observada contém deployments adicionais coerentes com rollback e restauração, e ao final o alias estável voltou a servir:

```text
version=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

A capacidade de rollback/restore também havia sido exercitada anteriormente durante a evolução da fase 004.

Entretanto, a auditoria não deve substituir a evidence gerada pelo workflow por inferência baseada somente em uma sequência de deployments. O fechamento formal da fase deve referenciar o run e o artifact de evidence correspondentes.

Classificação:

```text
rollback mechanism implemented       = YES
physical rollback/restore observed   = YES
workflow evidence correlation        = REQUIRED FOR FORMAL CLOSURE
```

---

# 7. Nova evidência física de production

A issue #5 registrava anteriormente que não existiam novos deployments produtivos após o merge da revisão `4575ffef...`. Essa informação ficou desatualizada.

O projeto produtivo agora possui novos deployments READY, incluindo:

```text
dpl_5Sno78V3q1aTqajiSY1iYCG3RXRo  READY
dpl_F4dxYRaaUji2pxfR5BhMbjkhKsHk  READY
dpl_HCh9jAeUNvD3FeSkeLB8TP48wkVv  READY
```

Projeto:

```text
name=moventra-tms
project_id=prj_5qFenjyeGE1joaGomaNrUIRGSBQs
latest=dpl_HCh9jAeUNvD3FeSkeLB8TP48wkVv
state=READY
```

O alias estável de produção respondeu `HTTP 200`:

```json
{
  "status": "ok",
  "product": "Moventra TMS",
  "service": "moventra-api",
  "version": "4575ffefce63b2bc2b75e6e9985a2b30c40b383b"
}
```

Portanto:

```text
production deployment exists              = EVIDENCED
production stable alias is healthy         = EVIDENCED
production revision == current main SHA    = EVIDENCED
```

A URL imutável mais recente está protegida por Vercel Authentication e responde com redirecionamento de autenticação quando acessada anonimamente; o alias estável permanece utilizável para o smoke público definido no estado atual.

---

# 8. Por que a fase 004 ainda não é marcada como CONCLUDED

O conector administrativo disponível nesta auditoria não expõe de forma suficiente, em uma única trilha confiável, todos os seguintes objetos da execução produtiva observada:

```text
Production Promotion workflow run ID
+
production environment approval history
+
production evidence artifact
+
artifact source run / exact digest
+
correlação desses objetos ao deployment Vercel observado
```

O fato de o workflow vigente ser fail-closed é uma propriedade importante, mas a auditoria não deve assumir que todo deployment físico encontrado no Vercel obrigatoriamente foi produzido por esse caminho sem a correlação do run.

Logo a decisão conservadora e auditável é:

```text
004 implementation                  = IMPLEMENTED
004 CI/staging/production physical  = EVIDENCED
004 formal protected approval       = PENDING CORRELATION
004 final evidence artifact         = PENDING CORRELATION
004                                != CONCLUDED
005                                != ACTIVE
```

Critério final de fechamento da 004:

1. identificar o `Moventra Production Promotion` run que originou a revisão produtiva atual;
2. confirmar `success` do preflight e do job protegido;
3. preservar o approval history contendo aprovador válido;
4. preservar/referenciar o production evidence artifact;
5. comprovar que o artifact source run, commit SHA e digest são os mesmos validados na cadeia de staging/rollback;
6. registrar a decisão formal `004 = CONCLUDED`.

---

# 9. Estado real do Neon / etapa 006

Projeto Neon:

```text
project=moventra-tms
project_id=shiny-mode-01639948
PostgreSQL=18.6
```

Branches identificadas:

```text
main        br-morning-glitter-au97suq4
development br-summer-cloud-aulfwdsv
staging     br-rapid-math-au6j6xut
```

A consulta somente leitura em Neon `main` confirmou:

```text
organization schema = false
identity schema     = false
audit schema        = false
foundation tables   = 0
```

Assim:

```text
0001_foundation.sql present in Git = YES
0001 applied to Neon main          = NO
006 Banco Base                     = NOT ACTIVE / NOT IMPLEMENTED
```

Nenhuma migration foi aplicada como parte desta auditoria.

---

# 10. Auditoria da migration 0001 antes da futura etapa 006

A migration foi corretamente mantida fora do banco produtivo até aqui, o que permite corrigir os pontos abaixo antes de promovê-la.

## F006-01 — Lifecycle de Tenant divergente da linha oficial

A migration atual usa:

```text
active
suspended
disabled
deleted
```

A especificação oficial da fundação prevê lifecycle orientado a processo:

```text
PROVISIONING
ACTIVE
SUSPENDED
CLOSING
CLOSED
```

Além disso, `deleted_at` já representa soft delete; misturar `deleted` como estado de negócio cria semânticas concorrentes.

**Decisão recomendada:** alinhar o lifecycle ao fluxo oficial e tratar remoção lógica separadamente.

## F006-02 — Lifecycle de User divergente

A migration atual usa:

```text
invited
active
blocked
disabled
deleted
```

A linha oficial prevê:

```text
INVITED
ACTIVE
LOCKED
SUSPENDED
DISABLED
```

**Decisão recomendada:** diferenciar lock técnico/segurança de suspensão administrativa e manter soft delete fora do estado operacional.

## F006-03 — `audit.actor_id` incompatível com ator polimórfico

`actor_type` aceita:

```text
user
service
integration
system
anonymous
```

mas `actor_id` possui FK direta para `identity.users(id)`.

Isso impede modelagem coerente de service accounts e integrações com identificadores próprios.

**Decisão recomendada:** remover a FK polimórfica direta de `actor_id` para `identity.users` e adotar contrato explícito de identidade de ator. A fundação pode manter `actor_id` como identificador interno opcional e `actor_ref` textual para origem externa/técnica, evoluindo posteriormente para um registry de atores se necessário.

## F006-04 — Auditoria pré-tenant / platform-scoped

`audit_logs.tenant_id` é atualmente obrigatório, enquanto `actor_type=anonymous` e eventos como falha de autenticação podem ocorrer antes de qualquer tenant ser resolvido.

**Decisão recomendada:** introduzir escopo explícito de auditoria (`platform` ou `tenant`) e permitir `tenant_id` nulo apenas no escopo de plataforma, protegido por CHECK constraints. Empresa e filial continuam proibidas sem tenant válido.

## F006-05 — Redaction e minimização de dados

`previous_data`, `new_data` e `metadata` são JSONB flexíveis. Sem política, podem capturar credenciais, tokens ou PII desnecessária.

**Decisão recomendada:** criar política transversal de redaction/classificação antes da auditoria de aplicação, proibindo secrets e minimizando dados pessoais.

## F006-06 — Migration framework ainda não evidenciado

Existe SQL versionado e validation SQL, mas a etapa 006 exige processo reproduzível de execução, versionamento, validação e promoção.

**Decisão recomendada:** ao ativar 006, escolher/implementar o migration runner oficial, executar primeiro em branch temporária Neon, validar estruturalmente e apenas depois promover por fluxo governado.

---

# 11. Outros achados de governança

## GOV-01 — Visibilidade pública do repositório

O repositório está atualmente `public`.

Para um TMS comercializável, isso deve ser uma **decisão explícita de governança**, considerando propriedade intelectual, exposição de arquitetura, histórico e política de contribuição. Esta auditoria não altera a visibilidade automaticamente.

Status:

```text
DECISION REQUIRED
```

## GOV-02 — Proteção de `main`

O GitHub reporta `main` como `protected=true`. O endpoint clássico de branch protection consultado não apresenta required status checks ativos, o que pode ocorrer quando a proteção principal está sendo aplicada por Rulesets.

Como o Rollback Drill depende de histórico linear de um único pai, a política administrativa final deve garantir explicitamente:

- Pull Request obrigatório;
- reviews conforme governança;
- required checks do CI oficial;
- linear history;
- bloqueio de force push/deletion;
- bypass restrito e auditável.

A configuração completa de Rulesets/Actions General não é totalmente exposta pelo conector atual; deve ser preservada como evidência administrativa do gate.

## GOV-03 — Estratégia de merge

O repositório permite merge, squash e rebase em nível global. Isso não é, por si só, falha, desde que o Ruleset de `main` imponha a invariável necessária à cadeia oficial.

Como o rollback automático deriva o pai do commit corrente e exige exatamente um pai, o histórico efetivo de `main` deve permanecer linear.

---

# 12. Arquitetura e segurança

## Arquitetura

ADR-0001 continua adequada: monólito modular, alta coesão, baixo acoplamento e extração de serviços apenas mediante evidência.

O teste de dependências atual protege a fundação `core` contra dependência direta de HTTP/Node, porém é apenas um baseline. Quando os primeiros domínios reais entrarem, os architecture tests devem evoluir para validar dependências entre módulos/bounded contexts.

## Multi-tenancy

ADR-0002 passa a ser classificada como **Aceita**, pois a estratégia já é a base oficial da migration e da documentação de segurança.

Isso não significa que G2 esteja concluído. Ainda faltam:

- Auth real;
- contexto tenant no backend;
- RBAC aplicado;
- RLS onde aplicável;
- testes cross-tenant;
- auditoria transversal da aplicação.

---

# 13. Gates consolidados

| Gate | Estado | Motivo |
|---|---|---|
| G1 — Foundation Ready | **NOT APPROVED** | 004 requer fechamento formal; 005/006 ainda não concluídas |
| G2 — Security Ready | **NOT APPROVED** | Auth/RBAC/isolamento/auditoria de aplicação ainda não implementados |
| G3+ | **NOT STARTED** | dependem dos gates anteriores |

---

# 14. Decisão executiva

Estado oficial após esta auditoria:

```text
001 — Governance          implemented/evidenced
002 — Architecture        implemented/evidenced
003 — Environments        partially implemented/evidenced
004 — CI/CD               formal closure pending evidence correlation
005 — Secrets             defined / not active
006 — Database Base       prepared / not active / not applied
007 — Data Conventions    defined/prepared
008–017                   prepared/defined only, not implemented
G1                        NOT APPROVED
G2                        NOT APPROVED
```

Próxima ação executiva obrigatória:

```text
correlacionar Production Promotion run
+
approval history
+
production evidence artifact
+
exact artifact SHA/digest
↓
004 = CONCLUDED
↓
005 = ACTIVE
```

Somente depois a linha pode continuar para 006.
