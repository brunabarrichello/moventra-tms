# Política de Secrets — Moventra TMS

## 1. Objetivo

Garantir que credenciais, chaves, tokens, certificados e demais materiais sensíveis sejam armazenados, injetados, rotacionados e auditados fora do código-fonte e fora de configurações comuns.

Gate da fase 005:

> Nenhum segredo operacional armazenado no código ou repositório.

## 2. Escopo

Aplica-se a GitHub Actions/Environments, Neon/PostgreSQL, Vercel, e-mail, SMS, WhatsApp, bancos, gateways, mapas, rastreadores, ERPs, SEFAZ, gerenciadoras de risco, webhooks e qualquer serviço externo integrado ao Moventra TMS.

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
| Public config | IDs de projeto sem privilégio, URLs públicas | sim, quando necessário | vars/config |
| Ephemeral credential | `GITHUB_TOKEN` emitido por job | não persistir | plataforma emissora |

## 5. Princípios obrigatórios

- secrets nunca no Git, documentação pública, issues, logs ou artifacts de build;
- secrets distintos por ambiente (`development`, `test`, `staging`, `production`);
- o mesmo nome lógico pode existir em ambientes diferentes, porém os valores devem ser independentes;
- menor privilégio e menor escopo possível;
- credenciais de workload separadas de credenciais humanas;
- rotação periódica e imediata após suspeita de exposição;
- revogação de credenciais não utilizadas;
- expiração habilitada quando suportada;
- auditoria de alterações e acessos quando o provedor suportar;
- workload identity/OIDC deve ser preferida a credenciais estáticas quando tecnicamente disponível;
- secrets nunca devem ser expostos ao frontend;
- logs devem mascarar valores e não registrar headers/connection strings sensíveis completos;
- nenhum secret deve ser enviado a Pull Requests não confiáveis.

## 6. Stores e escopo por ambiente

### GitHub Actions

Usar **GitHub Environments** para secrets específicos de ambiente e `vars` para identificadores não sensíveis.

Contrato atual da cadeia 004/005/006:

| Ambiente | Nome | Tipo | Consumidor | Observação |
|---|---|---|---|---|
| staging | `VERCEL_TOKEN` | secret | Bootstrap / Release Gate / Rollback Drill | valor não deve ser exposto |
| staging | `VERCEL_ORG_ID` | var | Bootstrap / Release Gate / Rollback Drill | identificador não sensível |
| staging | `DATABASE_URL` | secret | Release Gate | fonte protegida para sincronização do runtime Vercel; nunca registrar valor |
| production | `VERCEL_TOKEN` | secret | Production Promotion | deve ser independente do staging |
| production | `VERCEL_ORG_ID` | var | Production Promotion | identificador não sensível |
| production | `VERCEL_PRODUCTION_PROJECT_ID` | var | Production Promotion | identificador não sensível |
| job | `GITHUB_TOKEN` | ephemeral credential | GitHub REST API | permissões declaradas por workflow |

O staging não depende de um `VERCEL_STAGING_PROJECT_ID` estático. O Project ID corrente é resolvido pelo nome canônico `moventra-tms-staging` após convergência idempotente da política do projeto.

O repositório não deve depender de repository-level secrets para credenciais produtivas quando o consumo é específico de um environment.

### Banco de dados

`DATABASE_URL` é secret de runtime e deve ser segregada por ambiente/branch de banco. Em staging, a cópia mantida no GitHub Environment existe somente como fonte protegida de provisionamento; o Release Gate a sincroniza para a Vercel como variável `sensitive` com target `production`, sem imprimir payload ou resposta que possam conter o valor.

`DATABASE_MIGRATION_URL`, quando utilizada, deve permanecer separada da credencial de runtime e apontar para role de migração com privilégios estritamente necessários. A aplicação em runtime não deve receber credenciais de migração.

Nenhuma connection string real pode ser armazenada no Git, em issues, documentação, artifacts ou logs.

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
- artifacts de evidência podem conter somente metadata não secreta, como nome lógico, hash/digest, actor, run ID e estado.

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
- revisão periódica de acessos e rotação.

## 11. Incidente de exposição

1. revogar/rotacionar imediatamente a credencial;
2. identificar alcance, ambientes e período de exposição;
3. revisar logs e indícios de uso indevido;
4. remover o segredo do histórico quando aplicável;
5. registrar incidente e ações corretivas;
6. revisar permissões e consumidores;
7. criar prevenção automatizada para impedir recorrência.

## 12. Regra de evolução

Novos providers ou integrações não podem introduzir secrets diretamente em código. Todo novo secret deve entrar primeiro no inventário lógico desta política e ter store, escopo, owner, consumidor, rotação e forma de auditoria definidos.
