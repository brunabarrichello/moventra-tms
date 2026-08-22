# 005 — Modelo de Evidência Administrativa de Secrets

## Objetivo

Definir evidências auditáveis para comprovar segregação, rotação e controle de acesso de secrets sem expor seus valores.

## Princípio

GitHub Actions Secrets não expõe o valor armazenado pela API de leitura. A API retorna somente metadata, como nome, `created_at` e `updated_at`. Portanto, a conformidade da fase 005 não deve depender de recuperar ou comparar valores secretos.

A evidência válida deve comprovar independência operacional por ambiente por meio de metadata e processo administrativo controlado.

## Evidência mínima por secret operacional

| Campo | Obrigatório | Exemplo não sensível |
|---|---:|---|
| environment | sim | `staging` |
| logical_name | sim | `VERCEL_TOKEN` |
| secret_store | sim | `GitHub Environment` |
| provider | sim | `Vercel` |
| credential_identity | quando disponível | ID/label não secreto do token/provider |
| owner | sim | equipe responsável |
| created_at | quando disponível | timestamp |
| rotated_at | sim após rotação | timestamp |
| access_scope | sim | descrição de menor privilégio |
| evidence_source | sim | GitHub UI/API/audit log/provider metadata |
| value_exposed | sempre `false` | `false` |

## Regra de independência entre ambientes

Para `staging` e `production`, não é necessário nem permitido recuperar os valores para compará-los.

A independência deve ser comprovada por pelo menos um dos mecanismos abaixo:

1. IDs/labels distintos de credenciais no provider;
2. criação/rotação independente documentada para cada environment;
3. metadata de secret distinta por environment combinada com registro administrativo de provisionamento separado;
4. migração para workload identity/OIDC com subjects/scopes distintos por environment.

Apenas possuir o mesmo nome lógico em dois environments não é evidência suficiente de independência.

## Evidência de controle de acesso e rotação

A trilha mínima deve permitir responder:

- quem é o owner técnico da credencial;
- qual environment pode consumi-la;
- qual workflow/job a referencia;
- quando foi criada ou rotacionada pela última vez, quando essa metadata existir;
- qual evento administrativo comprova criação/atualização/rotação;
- qual é o procedimento de revogação;
- se o material secreto permaneceu oculto durante toda a verificação.

## Gate

A fase 005 pode ser concluída quando:

- secrets operacionais não estão no repositório;
- stores por environment estão definidos;
- logs/artifacts não revelam valores;
- política de rotação/revogação existe;
- independência operacional entre staging e production é comprovada por metadata/processo, sem comparação de valores;
- controle de acesso e última rotação são auditáveis.

## Proibição

Nunca registrar em GitHub, Jira, Confluence, documentação, chat, logs ou artifacts:

- valor do secret;
- hash derivado do valor do secret para finalidade de comparação;
- screenshot que revele o valor;
- exportação do secret para “provar” diferença entre ambientes.
