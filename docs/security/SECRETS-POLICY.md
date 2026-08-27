# Política de Secrets — Moventra TMS

## 1. Objetivo

Garantir que credenciais, chaves, tokens, certificados e demais materiais sensíveis sejam armazenados, injetados, rotacionados e auditados fora do código-fonte e fora de configurações comuns.

Gate da fase 005:

> Nenhum segredo operacional armazenado no código ou repositório.

A fonte canônica de inventário lógico de configuração é `docs/governance/VARIABLES-MATRIX.md`. Esta política define classificação, armazenamento e controles; a matriz define sistema, ambiente, variável, origem, consumidor, status, divergência e ação.

## 2. Escopo

Aplica-se a GitHub Actions/Environments, Neon/PostgreSQL, Vercel, Railway, RabbitMQ, e-mail, SMS, WhatsApp, bancos, gateways, mapas, rastreadores, ERPs, SEFAZ, gerenciadoras de risco, webhooks e qualquer serviço externo integrado ao Moventra TMS.

## 3. Categorias obrigatórias

- Database Credentials;
- API Keys;
- OAuth Secrets;
- Signing Keys;
- Encryption Keys;
- Certificates;
- Provider Tokens;
- Webhook Secrets.

## 4. Classificação

| Classe | Exemplos | Pode estar no Git? | Store obrigatório |
|---|---|---:|---|
| Secret | senhas, tokens, connection strings com credenciais, client secrets | não | secret store do ambiente |
| Private key | chaves privadas, certificados PKCS#12/PFX | não | secret store/KMS apropriado |
| Sensitive config | identificadores internos sensíveis, endpoints privados | não por padrão | secret/secure config store |
| Public config | IDs de projeto sem privilégio, URLs públicas, issuer/audience/JWKS públicos, algoritmo e ordem de subject claims JWT | sim, quando necessário | vars/config |
| Public key | chave pública de validação/assinatura | sim, quando não contiver material privado | config ou fonte pública governada |
| Ephemeral credential | `GITHUB_TOKEN` emitido por job | não persistir | plataforma emissora |

## 5. Princípios obrigatórios

- secrets nunca no Git, documentação pública, issues, logs ou artifacts de build;
- secrets distintos por ambiente (`development`, `test`, `staging`, `production`);
- o mesmo nome lógico pode existir em ambientes diferentes, porém os valores devem ser independentes;
- menor privilégio e menor escopo possível;
- credenciais de workload separadas de credenciais humanas;
- credenciais de runtime separadas de credenciais de migration/control plane;
- rotação periódica e imediata após suspeita de exposição;
- revogação de credenciais não utilizadas;
- expiração habilitada quando suportada;
- auditoria de alterações e acessos quando o provedor suportar;
- workload identity/OIDC deve ser preferida a credenciais estáticas quando tecnicamente disponível;
- secrets nunca devem ser expostos ao frontend;
- logs devem mascarar valores e não registrar headers/connection strings sensíveis completos;
- nenhum secret deve ser enviado a Pull Requests não confiáveis;
- ausência de secret obrigatório em Staging/Production deve resultar em fail-closed.

## 6. Stores e escopo por ambiente

### GitHub Actions

Usar **GitHub Environments** para secrets específicos de ambiente e `vars` para identificadores não sensíveis.

Contrato atual da cadeia de release:

| Ambiente | Nome | Tipo | Consumidor | Observação |
|---|---|---|---|---|
| staging | `VERCEL_TOKEN` | secret | Bootstrap / Release Gate / Rollback Drill | valor não deve ser exposto |
| staging | `VERCEL_ORG_ID` | var | Bootstrap / Release Gate / Rollback Drill | identificador não sensível |
| staging | `DATABASE_URL` | secret | Release Gate | runtime PostgreSQL de Staging; fonte protegida para sincronização do runtime Vercel |
| staging | `MIGRATIONS_DATABASE_URL` | secret | Release Gate | control plane de migrations; nunca injetar no runtime da aplicação |
| staging | `MESSAGING_RABBITMQ_URL` | secret | Release Gate / smoke de mensageria | credencial TLS do broker de Staging |
| production | `VERCEL_TOKEN` | secret | Production Promotion | deve ser independente do staging |
| production | `VERCEL_ORG_ID` | var | Production Promotion | identificador não sensível |
| production | `VERCEL_PRODUCTION_PROJECT_ID` | var | Production Promotion | identificador não sensível |
| production | `DATABASE_URL` | secret | Production Promotion | runtime PostgreSQL de Production |
| production | `MIGRATIONS_DATABASE_URL` | secret | Production Promotion | control plane de migrations; segregado do runtime |
| production | `MESSAGING_RABBITMQ_URL` | secret | Production Promotion / smoke de mensageria | credencial TLS do broker de Production |
| job | `GITHUB_TOKEN` | ephemeral credential | GitHub REST API | permissões mínimas declaradas por workflow/job |

O staging não depende de um `VERCEL_STAGING_PROJECT_ID` estático. O Project ID corrente é resolvido pelo nome canônico `moventra-tms-staging` após convergência idempotente da política do projeto.

O repositório não deve depender de repository-level secrets para credenciais produtivas quando o consumo é específico de um environment.

### Vercel

Vercel mantém apenas secrets/configurações necessárias ao runtime das Functions. O deploy governado sincroniza valores sensíveis sem imprimir payload ou resposta que possam conter o valor.

- `DATABASE_URL`: secret de runtime PostgreSQL;
- `MESSAGING_RABBITMQ_URL`: secret do broker;
- `MESSAGING_PROVIDER`: configuração não secreta, explicitamente `rabbitmq` em Staging/Production governados;
- `MOVENTRA_ENV`: configuração não secreta de ambiente;
- `MOVENTRA_AUTH_PROVIDER_KEY`, `MOVENTRA_AUTH_JWT_ISSUER`, `MOVENTRA_AUTH_JWT_AUDIENCE`, `MOVENTRA_AUTH_JWT_ALGORITHM`, `MOVENTRA_AUTH_JWT_SUBJECT_CLAIMS`, `MOVENTRA_AUTH_JWT_JWKS_URL`: trust material público/configuracional;
- `MOVENTRA_AUTH_JWT_SUBJECT_CLAIMS`: lista ordenada não secreta de claims aceitas para resolução do subject; contrato atual `sub,id`; deve ser sincronizada e validada de forma explícita e fail-closed;
- `MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM`: snapshot de chave **pública**; nunca deve conter chave privada;
- `MIGRATIONS_DATABASE_URL`: proibida no runtime Vercel da aplicação.

A chave privada JWT permanece exclusivamente no IdP/emissor. Nenhuma chave privada do IdP pertence ao Moventra runtime ou repositório.

### Railway

O Worker dedicado recebe apenas credenciais e configurações necessárias à execução de Jobs, Outbox, mensageria e DLQ.

- `DATABASE_URL`: secret de runtime com principal PostgreSQL dedicado e menor privilégio;
- `MESSAGING_RABBITMQ_URL`: secret do broker;
- `MOVENTRA_RELEASE_SHA`: identidade não secreta da revisão implantada;
- variáveis automáticas `RAILWAY_*`: propriedade da plataforma e não devem ser copiadas para `.env.example` como contrato da aplicação.

`MIGRATIONS_DATABASE_URL` não deve ser entregue ao Worker.

### Banco de dados

`DATABASE_URL` é secret de runtime e deve ser segregada por ambiente/branch de banco. Em staging, a cópia mantida no GitHub Environment existe somente como fonte protegida de provisionamento; o Release Gate a sincroniza para a Vercel como variável `sensitive`, sem imprimir payload ou resposta que possam conter o valor.

`MIGRATIONS_DATABASE_URL` é o nome canônico da credencial de migration/control plane. Deve permanecer separada da credencial de runtime e apontar para role de migração com privilégios estritamente necessários. A aplicação em runtime, o Worker e o frontend não devem receber essa credencial.

Nenhuma connection string real pode ser armazenada no Git, em issues, documentação, artifacts ou logs.

### RabbitMQ

`MESSAGING_RABBITMQ_URL` é secret e deve ser independente por ambiente. Staging e Production exigem `amqps://` e TLS. Exchange, queue, DLX, prefetch e timeouts são configurações operacionais não secretas e podem usar defaults governados pelo código quando documentado.

## 7. Desenvolvimento local

- usar `.env` ou `.env.<ambiente>` somente localmente;
- esses arquivos devem permanecer ignorados pelo Git;
- `.env.example` pode ser versionado apenas com nomes de variáveis e valores vazios/documentais;
- nenhum dump, chave, certificado privado ou arquivo de credenciais deve ser salvo dentro do repositório.

## 8. CI/CD

- secrets entram por secret store do ambiente;
- `persist-credentials: false` deve ser mantido nos checkouts salvo exceção formalmente aprovada;
- `GITHUB_TOKEN` deve usar permissions mínimas por workflow/job;
- workflows não devem imprimir secrets nem passá-los como argumentos de linha de comando quando existir alternativa por environment/stdin;
- falha na resolução de secret obrigatório deve resultar em fail-closed;
- sincronizações de secrets para providers externos devem usar payload temporário com permissões restritas e eliminar arquivos temporários ao final;
- respostas de APIs de secrets não devem ser impressas quando puderem conter valores sensíveis;
- artifacts de evidência podem conter somente metadata não secreta, como nome lógico, hash/digest, actor, run ID e estado;
- `MIGRATIONS_DATABASE_URL` deve existir somente nos jobs de control plane que aplicam/verificam migrations;
- identidade de release deve ser propagada por valor imutável (`APP_VERSION` no artefato Vercel; `MOVENTRA_RELEASE_SHA` no Worker).

## 9. Rotação e revogação

Cada secret operacional deve possuir:

- owner técnico;
- sistemas consumidores;
- ambientes onde existe;
- data de criação/última rotação quando disponível;
- prazo ou política de rotação;
- procedimento de revogação;
- plano de substituição sem indisponibilidade quando aplicável.

Rotação emergencial é obrigatória após suspeita de vazamento, comprometimento de conta, alteração de equipe com acesso privilegiado ou uso indevido.

## 10. Auditoria

A evidência de conformidade deve ser composta por metadata e controles, nunca pelos valores secretos. Quando a API disponível não expuser metadata administrativa de secrets, a ausência dessa capacidade deve ser registrada como limitação de auditoria e não deve ser compensada expondo valores.

Controles mínimos:

- nenhum `.env` real rastreado;
- nenhuma chave privada/credential file rastreada;
- secret consumido por environment protegido;
- logs sem valores de secrets;
- distinção formal entre `secrets` e `vars`;
- `DATABASE_URL` e `MIGRATIONS_DATABASE_URL` segregadas;
- nenhum `VERCEL_STAGING_PROJECT_ID` estático requerido pelo release de Staging;
- trust material JWT público, incluindo `MOVENTRA_AUTH_JWT_SUBJECT_CLAIMS`, sincronizado sem chave privada e coerente com a Matriz Mestre;
- revisão periódica de acessos e rotação;
- inventário lógico sincronizado com `docs/governance/VARIABLES-MATRIX.md` e `.env.example`.

## 11. Incidente de exposição

1. revogar/rotacionar imediatamente a credencial;
2. identificar alcance, ambientes e período de exposição;
3. revisar logs e indícios de uso indevido;
4. remover o segredo do histórico quando aplicável;
5. registrar incidente e ações corretivas;
6. revisar permissões e consumidores;
7. criar prevenção automatizada para impedir recorrência.

## 12. Regra de evolução

Novos providers ou integrações não podem introduzir secrets diretamente em código. Todo novo secret deve entrar primeiro no inventário lógico desta política e na Matriz Mestre de Variáveis, com store, escopo, owner, consumidor, rotação e forma de auditoria definidos.

Novas variáveis de configuração usadas pelo runtime devem ser adicionadas ao `.env.example` com atribuição vazia e documentação de default/semântica. Variáveis automáticas de plataforma (`RAILWAY_*`, `VERCEL_*` automáticas, `GITHUB_*`) não devem ser tratadas como contrato de aplicação salvo quando o código depender explicitamente delas.
