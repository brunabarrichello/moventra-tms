# 004 — Production Promotion — Causa-raiz e Correção — 2026-08-22

## 1. Objetivo

Registrar a evidência autoritativa encontrada durante o fechamento da fase **004 — CI/CD**, a causa-raiz da promoção produtiva incompleta e as correções aplicadas antes de uma nova execução oficial.

Este registro não promove a etapa 005. A fase 004 somente poderá ser concluída após nova cadeia bem-sucedida com evidence artifact produtivo e approval history preservados.

---

## 2. Revisão canônica investigada

```text
main_sha=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

Foram encontrados dois runs de `Moventra Production Promotion` associados a essa revisão:

```text
32581944193  run #1  workflow_run       failure
32586022175  run #2  workflow_dispatch  failure
```

Nenhum dos dois representa fechamento formal da 004.

---

## 3. Run automático #1 — evidência autoritativa

```text
production_run_id=32581944193
trigger=workflow_run
head_branch=main
head_sha=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
conclusion=failure
```

### 3.1 Preflight fail-closed

O job `Production fail-closed preflight` concluiu com `success`.

Foram aprovados os controles obrigatórios:

- Rollback Drill válido;
- rollback evidence baixada;
- rollback/restore evidence validada;
- artifact exato de `main` validado;
- environment `production` existente e protegido.

Portanto, a execução produtiva não contornou o gate de rollback nem o preflight.

### 3.2 Approval protegido

No job `Protected production deployment`, o step:

```text
Capture authoritative environment approval = success
```

A própria validação do workflow exige:

- review `approved` no environment `production`;
- aprovador não vazio;
- aprovador diferente do ator de origem.

O ator de origem observado foi:

```text
workflow_source_actor=brunabarrichello
```

O run ultrapassou esse step, portanto a aprovação protegida ocorreu e satisfez essas condições. A identidade nominal do aprovador deve ser preservada pela próxima execução no `approval-history.json` e no production evidence artifact.

### 3.3 Mesmo artifact

A execução baixou do CI:

```text
source_ci_run_id=32581808441
github_artifact_name=moventra-tms-4575ffefce63b2bc2b75e6e9985a2b30c40b383b
github_artifact_id=9477994596
github_archive_digest=sha256:515af433cee290c9c3f9b50d5d83c3eeb69c5d9d7ee2eab3c7a9240925112080
```

O contrato interno foi revalidado antes do deploy:

```text
commit_sha=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
artifact_sha256=65d2edc3c73bcd49d4bff7a4833bdf85958eaaea8e94f4fa481bc943a7e2d3a8
```

Não houve rebuild entre CI e produção.

### 3.4 Deployment produtivo correlacionado

O step `Deploy exact approved prebuilt artifact to production` concluiu com `success` e registrou no log:

```text
Inspect=https://vercel.com/alebru/moventra-tms/HCh9jAeUNvD3FeSkeLB8TP48wkVv
Production=https://moventra-qdeqqgj3y-alebru.vercel.app
commit_sha=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
artifact_sha256=65d2edc3c73bcd49d4bff7a4833bdf85958eaaea8e94f4fa481bc943a7e2d3a8
```

A Vercel confirma:

```text
deployment_id=dpl_HCh9jAeUNvD3FeSkeLB8TP48wkVv
project=moventra-tms
state=READY
target=production
source=cli
```

Assim, o deployment físico `dpl_HCh9j...` está diretamente correlacionado ao run `32581944193` e ao artifact acima.

---

## 4. Falha real do run #1

O primeiro smoke no alias público:

```text
https://moventra-tms.vercel.app
```

passou com a revisão exata:

```text
health smoke passed (http)
version=4575ffefce63b2bc2b75e6e9985a2b30c40b383b
```

O segundo smoke utilizou:

```text
https://moventra-tms-alebru.vercel.app
```

Esse alias está protegido por Vercel Authentication e responde com redirecionamento SSO para acesso anônimo.

O script vigente executava `curl --location`, baixando a página de autenticação, e depois transportava todo o corpo através de variável de ambiente:

```text
RESPONSE=<body> node ...
```

A resposta SSO excedeu o limite de argumentos/ambiente do processo e causou repetidamente:

```text
/usr/local/bin/node: Argument list too long
```

Após 12 tentativas:

```text
health smoke failed
exit=69
```

Como consequência, os steps de gravação e upload da production evidence foram corretamente ignorados após a falha.

Logo:

```text
production deploy = success
exact public alias smoke = success
protected alias smoke = technical failure
production evidence artifact = not generated
run conclusion = failure
004 = not concluded
```

---

## 5. Run manual #2

```text
production_run_id=32586022175
trigger=workflow_dispatch
conclusion=failure
```

O input `rollback_run_id` recebeu por engano:

```text
32581944193
```

que é o ID do Production Promotion run #1, e não um `Moventra Rollback Drill`.

O preflight rejeitou corretamente:

```text
Selected run is not Moventra Rollback Drill
```

Nenhum job produtivo foi executado nesse run.

Esse comportamento confirma o fail-closed do preflight manual.

---

## 6. Correções implementadas

### 6.1 Smoke protegido sem `ARG_MAX`

`scripts/release/smoke-health.sh` foi alterado para:

- validar o JSON recebido por `stdin`, não por variável de ambiente;
- não seguir redirect anônimo de autenticação;
- em modo `auto`, permitir que um 302/HTML protegido caia imediatamente para o smoke autenticado via Vercel CLI;
- preservar validação obrigatória de `status`, `product`, `service` e `version`.

O gate não foi afrouxado: somente o transporte e o tratamento de autenticação foram corrigidos.

### 6.2 URL imutável de deployment

Foi identificado outro defeito no adaptador: a seleção por `tail -1` podia retornar o alias mutável da Vercel, em vez da URL imutável do deployment.

Foi criado:

```text
scripts/release/vercel-deployment-url.sh
```

O adaptador agora seleciona deterministicamente a primeira URL `*.vercel.app` emitida pela Vercel, correspondente ao deployment produtivo exato antes dos aliases.

### 6.3 Testes de regressão

Foram adicionados testes automatizados que comprovam:

1. smoke aceita exatamente uma resposta saudável com o SHA esperado;
2. smoke anônimo não segue redirect SSO;
3. resposta inválida de 512 KiB não causa `Argument list too long`;
4. parser Vercel preserva a URL imutável antes dos aliases mutáveis.

No `Moventra CI #43`, os quatro testes concluíram com `success`, junto dos testes existentes.

---

## 7. Decisão de gate

As evidências encontradas melhoram significativamente a rastreabilidade da 004, mas o run produtivo original terminou em `failure` e não gerou o artifact final de evidence.

Portanto a decisão continua:

```text
004 = IN PROGRESS / REMEDIATED / REEXECUTION REQUIRED
005 = NOT ACTIVE
G1  = NOT APPROVED
```

A próxima execução oficial deve ocorrer somente após merge destas correções em `main` e deve produzir a cadeia completa:

```text
Moventra CI(main)
→ Release Gate staging
→ Rollback Drill
→ Production Promotion
→ protected human approval
→ exact same immutable artifact
→ immutable deployment smoke
→ stable production smoke
→ production-deployment-<sha> artifact
→ approval-history.json
→ 004 = CONCLUDED
→ 005 = ACTIVE
```
