# 006 — Banco Base

## Estado

`ACTIVE`

Dependência satisfeita: `005 — Secrets Management`.

## Objetivo

Estabelecer a fundação PostgreSQL oficial do Moventra TMS, reproduzível por migrations, segregada por ambiente e preparada para as fases seguintes de convenções de dados, tenant, empresa, filial, usuários, RBAC, RLS e auditoria.

## Infraestrutura oficial identificada

Provider: Neon Postgres.

Projeto: `moventra-tms`

Project ID: `shiny-mode-01639948`

Região: `aws-us-east-1`

PostgreSQL: `18.6`

Database inicial: `neondb`

Timezone atual do servidor: `GMT`.

### Branches Neon existentes

| Ambiente lógico | Branch Neon | Branch ID | Estado |
|---|---|---|---|
| production/base | `main` | `br-morning-glitter-au97suq4` | ready |
| staging | `staging` | `br-rapid-math-au6j6xut` | ready |
| development | `development` | `br-summer-cloud-aulfwdsv` | ready |

Não criar projeto Neon duplicado enquanto este permanecer como source of truth.

## Baseline verificado em `main`

- database `neondb` acessível com role proprietária;
- schema de aplicação atual: `public`;
- zero tabelas de aplicação;
- zero views de aplicação;
- extensão instalada: apenas `plpgsql`;
- existe função utilitária `public.show_db_tree`, criada pela infraestrutura/ferramenta;
- nenhum domínio TMS foi materializado ainda;
- `DATABASE_URL` já existe apenas como nome de contrato em `.env.example`, sem valor versionado.

## Decisões da fase

1. PostgreSQL/Neon é o banco transacional primário inicial do monólito modular.
2. O banco deve ser criado/evoluído exclusivamente por migrations versionadas e reproduzíveis.
3. Nenhuma credencial ou connection string real será versionada.
4. `DATABASE_URL` será resolvida por secret store por ambiente.
5. Migrations devem ser idempotentes quando aplicável, auditáveis e validadas antes da promoção.
6. Alterações de schema serão testadas em branch temporária/ambiente não produtivo antes de aplicação em `main`.
7. Esta fase não cria ainda entidades de tenant, empresa, filial ou usuário; elas pertencem às fases oficiais posteriores.
8. Convenções detalhadas de nomenclatura e tipos de domínio pertencem à fase `007 — Convenções de Dados`, mas a 006 deve preparar o mecanismo de migration para aplicá-las.

## Trabalho ativo

- [x] identificar projeto Neon oficial existente;
- [x] identificar versão PostgreSQL, região e database inicial;
- [x] inventariar branches `main`, `staging` e `development`;
- [x] confirmar baseline vazio de tabelas/views de aplicação;
- [ ] selecionar e integrar driver PostgreSQL e mecanismo de migrations ao repositório;
- [ ] criar estrutura versionada de migrations;
- [ ] criar migration baseline não-domínio e controle de versão do schema;
- [ ] validar migration em branch temporária/ambiente de desenvolvimento;
- [ ] garantir execução repetível em banco limpo;
- [ ] adicionar testes/CI do contrato de banco;
- [ ] definir configuração segura de `DATABASE_URL` por ambiente sem expor valores;
- [ ] documentar rollback/forward-fix da fundação do banco;
- [ ] validar evidências e concluir 006.

## Gate de conclusão

A fase 006 somente será `CONCLUDED` quando houver, no mínimo:

- conexão PostgreSQL integrada ao código sem secret versionado;
- migration framework versionado no repositório;
- baseline reproduzível a partir de banco limpo;
- execução e validação em ambiente não produtivo;
- CI cobrindo migrations/contrato básico do banco;
- documentação de aplicação, rollback/forward-fix e evidências;
- nenhuma entidade de fase posterior antecipada indevidamente.

Até lá:

```text
005 = CONCLUDED
006 = ACTIVE
007 = NOT ACTIVE
G1  = NOT APPROVED
```
