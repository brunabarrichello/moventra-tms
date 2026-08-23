# Convenções de Dados — Moventra TMS

**Status:** CANÔNICO
**Fase de origem:** `007 — Convenções de Dados`
**Aplica-se a:** migrations, schemas PostgreSQL, persistência de domínio, contratos de API e integrações que representem dados do Moventra.

Este documento é o contrato normativo de dados do Moventra TMS. As fases 008+ devem obedecê-lo. Exceções exigem justificativa explícita, teste proporcional e registro arquitetural quando alterarem um princípio estrutural.

Palavras normativas:

- **DEVE / NÃO DEVE**: requisito obrigatório;
- **DEVERIA / NÃO DEVERIA**: padrão preferencial, com exceção justificável;
- **PODE**: opção válida quando compatível com o domínio.

A migration `0001_foundation.sql` é um baseline técnico anterior a este contrato e permanece válida; não deve ser reescrita para adequação cosmética.

---

## 1. Identificadores

### 1.1 Chaves primárias de domínio

- Novas entidades e agregados de domínio **DEVEM** usar PostgreSQL `UUID` como tipo de identificador interno, salvo exceção estrutural documentada, como tabela técnica singleton ou relacionamento cuja PK composta seja deliberada.
- Para o baseline PostgreSQL 18+, o gerador padrão é **UUIDv7**, usando `uuidv7()` quando o identificador for gerado no banco.
- Identificadores UUIDv7 gerados na aplicação **DEVEM** ser compatíveis com RFC 9562 e persistidos como `UUID`, nunca como texto.
- UUIDv4 não é o padrão para novas PKs de domínio. Uso excepcional exige justificativa.
- O fato de UUIDv7 ser temporalmente ordenável **NÃO DEVE** ser usado como substituto de `created_at`, ordenação de negócio ou trilha de auditoria.

Exemplo preferencial para uma futura entidade de domínio:

```sql
id UUID PRIMARY KEY DEFAULT uuidv7()
```

### 1.2 Chaves de negócio

- Chaves de negócio, como documentos, números fiscais, placas, códigos contratuais ou números operacionais, **NÃO DEVEM** substituir a PK técnica.
- Chaves de negócio **DEVEM** possuir `UNIQUE`/índice único no escopo correto quando a regra exigir unicidade.
- Normalização, case folding, pontuação e formatação de uma chave de negócio **DEVEM** ser definidos pelo domínio antes de criar a constraint.

### 1.3 IDs externos e integrações

- Identificadores de providers externos **DEVEM** ser tratados como dados externos, sem substituir a identidade interna do Moventra.
- A unicidade de um ID externo **DEVE** considerar o provider/conexão e o escopo SaaS aplicável.
- IDs externos podem ser `TEXT` quando o provider não fornecer tipo estável mais específico.

### 1.4 Exposição em APIs

- UUIDs **DEVEM** ser expostos como strings canônicas com hífens.
- APIs **NÃO DEVEM** expor sequências internas previsíveis como mecanismo de autorização.
- Autorização sempre depende do contexto autenticado e do escopo do recurso, nunca do formato do ID.

---

## 2. Nomenclatura PostgreSQL

### 2.1 Regras gerais

- Schemas, tabelas, colunas, constraints e índices **DEVEM** usar `snake_case`, ASCII minúsculo e nomes descritivos.
- Tabelas de domínio **DEVEM** usar substantivos no plural.
- Colunas **DEVEM** usar substantivos no singular.
- Abreviações obscuras **NÃO DEVEM** ser usadas.
- Nomes devem permanecer abaixo do limite de identificadores do PostgreSQL; abreviação é permitida somente quando inequívoca.

### 2.2 Schemas

- Schemas separam responsabilidade arquitetural, não tenant.
- Dados de tenants diferentes **NÃO DEVEM** ser separados por schema como estratégia primária de tenancy.
- Schemas técnicos, como `moventra_meta`, devem permanecer separados dos futuros schemas de domínio.

### 2.3 Sufixos semânticos de colunas

| Semântica | Padrão |
|---|---|
| Identificador | `*_id` |
| Instante | `*_at` |
| Data civil | `*_date` |
| Hora civil/local | `*_time` |
| Timezone IANA | `*_timezone` |
| Valor monetário | `*_amount` |
| Código de moeda | `*_currency` |
| Versão otimista | `version` |
| Exclusão lógica | `deleted_at` |

Booleanos **DEVERIAM** usar prefixos como `is_`, `has_` ou `can_` quando isso tornar a semântica inequívoca.

### 2.4 Nomes de constraints e índices

Usar os formatos:

```text
pk_<table>
fk_<table>_<column>
uq_<table>_<scope_and_columns>
ck_<table>_<rule>
ix_<table>_<scope_and_columns>
```

Quando uma PK inline não receber nome explícito, isso é aceitável. Constraints relevantes para diagnóstico, integridade tenant-aware ou regras de negócio **DEVERIAM** ser nomeadas explicitamente.

---

## 3. Multi-tenancy e escopo organizacional

### 3.1 Classificação de escopo

Cada nova tabela **DEVE** ser classificada em uma destas categorias antes da migration:

1. **técnica/global** — metadado interno ou catálogo realmente global;
2. **tenant-scoped** — pertencente a um tenant;
3. **company-scoped** — pertence a uma empresa dentro do tenant;
4. **branch-scoped** — pertence a uma filial dentro do tenant.

Não adicionar `tenant_id`, `company_id` ou `branch_id` por conveniência. O escopo **DEVE** refletir propriedade e autorização reais.

### 3.2 `tenant_id`

- Toda tabela `tenant-scoped`, `company-scoped` ou `branch-scoped` **DEVE** possuir `tenant_id UUID NOT NULL`.
- Uniques de dados tenant-scoped **DEVEM** incluir `tenant_id`, salvo quando a regra for comprovadamente global.
- Índices usados por consultas tenant-scoped **DEVERIAM** iniciar por `tenant_id` quando isso corresponder ao padrão de acesso.
- Consultas futuras a recursos tenant-scoped **NÃO DEVEM** operar sem contexto de tenant no backend.

### 3.3 `company_id` e `branch_id`

- `company_id` **DEVE** existir somente quando a entidade possuir escopo real de empresa.
- `branch_id` **DEVE** existir somente quando a entidade possuir escopo real de filial.
- Se `branch_id` já determinar `company_id`, armazenar ambos só é permitido quando houver necessidade operacional explícita e constraint que impeça combinação inconsistente.

### 3.4 Foreign keys tenant-aware

Para relações entre dados tenant-scoped, a integridade **DEVE** impedir referência cruzada entre tenants.

Padrão preferencial:

- a tabela pai mantém PK técnica `id` e uma chave candidata `UNIQUE (tenant_id, id)`;
- a tabela filha referencia `(tenant_id, parent_id)` para `(tenant_id, id)`.

Isso evita depender apenas de filtro de aplicação para integridade referencial. RLS futura continua sendo defesa adicional, não substituto desta regra nem da autorização no backend.

### 3.5 Soft delete e unicidade

Quando uma entidade soft-deletable puder reutilizar uma chave de negócio após exclusão, usar índice único parcial com `WHERE deleted_at IS NULL`. Se a regra exigir unicidade histórica, manter unique sem filtro.

---

## 4. Datas, horários e fusos

### 4.1 Instantes

- Instantes técnicos e eventos **DEVEM** usar `TIMESTAMPTZ`.
- O banco e a aplicação **DEVEM** tratar instantes em UTC.
- Colunas com sufixo `_at` **DEVEM** ser `TIMESTAMPTZ`.
- `created_at` **DEVE** ser `TIMESTAMPTZ NOT NULL DEFAULT now()` em registros persistentes mutáveis ou históricos quando a semântica existir.
- `updated_at`, quando aplicável, **DEVE** ser `TIMESTAMPTZ NOT NULL`; sua atualização deve ocorrer na mesma transação da alteração. Não depender de valor default para representar atualizações futuras.
- `TIMESTAMP WITHOUT TIME ZONE` **NÃO DEVE** representar um instante absoluto.

### 4.2 Datas e horas civis

- Datas sem instante, como competência, vencimento civil ou data fiscal, **DEVEM** usar `DATE`.
- Horas locais recorrentes sem data **PODEM** usar `TIME WITHOUT TIME ZONE` quando acompanhadas do contexto de timezone necessário.
- Strings **NÃO DEVEM** substituir tipos nativos de data/hora.

### 4.3 Timezone de negócio

- Timezones de negócio **DEVEM** usar identificadores IANA, por exemplo `America/Sao_Paulo`.
- Offset fixo, como `-03:00`, **NÃO DEVE** substituir timezone IANA em regras sujeitas a horário de verão ou legislação local.
- O timezone efetivo poderá ser resolvido futuramente por tenant/empresa/filial conforme configuração e escopo; a regra de resolução deve ser explícita.

### 4.4 APIs

- Instantes devem ser serializados em RFC 3339/ISO 8601, preferencialmente UTC com `Z`.
- Datas civis devem ser `YYYY-MM-DD`.
- O consumidor não deve inferir timezone de negócio a partir do timezone do navegador ou servidor.

---

## 5. Valores monetários e moeda

### 5.1 Tipos

- Dinheiro **NÃO DEVE** usar `REAL`, `DOUBLE PRECISION`, `FLOAT` ou `Number` JavaScript como representação autoritativa.
- O tipo PostgreSQL `MONEY` **NÃO DEVE** ser usado.
- Valores monetários persistidos **DEVEM** usar `NUMERIC`/`DECIMAL` com precisão e escala explícitas.

Padrões iniciais:

| Categoria | PostgreSQL | Uso |
|---|---|---|
| Montante monetário | `NUMERIC(19,4)` | fretes, custos, pagamentos, recebimentos, adicionais |
| Preço/tarifa unitária de alta precisão | `NUMERIC(19,6)` | preço por kg/km/unidade quando necessário |
| Percentual/taxa | `NUMERIC(12,8)` | percentuais, fatores e alíquotas quando o domínio permitir |

Uma fase de domínio **PODE** escolher escala diferente quando houver requisito fiscal, bancário, contratual ou de provider, mas deve documentar e testar a decisão.

### 5.2 Moeda

- Quando um valor puder variar de moeda, o registro **DEVE** persistir o código de moeda junto do valor.
- Código de moeda **DEVE** usar ISO 4217 em três letras maiúsculas.
- Não inferir moeda apenas do tenant se o registro puder sobreviver a mudança de configuração ou participar de reconciliação histórica.

### 5.3 Arredondamento

- Arredondamento **DEVE** ocorrer em ponto de negócio explícito, não de forma acidental em UI, JSON ou cast.
- A regra de arredondamento precisa ser reproduzível e versionável quando afetar cálculo contratual, fiscal ou financeiro.
- Quando nenhuma regra externa/domínio prescrever outra política, usar arredondamento decimal para o vizinho mais próximo com empate afastando de zero (`HALF_UP`).
- Regras de SEFAZ, banco, gateway, contrato ou legislação prevalecem e devem ser registradas no cálculo correspondente.

### 5.4 APIs

- Valores decimais autoritativos **DEVEM** trafegar como strings decimais em JSON para evitar perda de precisão binária.
- O código de moeda deve acompanhar o valor quando aplicável.

Exemplo:

```json
{
  "amount": "1250.3750",
  "currency": "BRL"
}
```

---

## 6. Exclusão, histórico, retenção e LGPD

### 6.1 Hard delete

Hard delete é permitido somente quando:

- o dado é técnico/transitório ou não possui obrigação histórica;
- não há referência que precise permanecer íntegra;
- a exclusão é compatível com regras legais, fiscais, financeiras e de auditoria.

Hard delete **NÃO DEVE** ser a estratégia de correção para registros financeiros, fiscais, operacionais históricos ou auditoria.

### 6.2 Soft delete

- Soft delete deve ser usado somente quando recuperação, rastreabilidade cadastral ou regra de negócio justificarem.
- O padrão de coluna é `deleted_at TIMESTAMPTZ` nullable.
- Registros ativos usam `deleted_at IS NULL`.
- Repositórios futuros **DEVEM** aplicar o filtro de ativo de forma consistente sem enfraquecer o filtro de tenant.
- Restauração, quando permitida, deve revalidar uniques, estado e autorização.

### 6.3 Append-only e reversão

Dados financeiros, fiscais, trilhas de auditoria e eventos que representem fatos consumados **DEVEM** preferir modelo append-only.

Correções devem usar uma destas estratégias conforme o domínio:

- estorno/reversal;
- evento compensatório;
- nova versão;
- supersessão explícita.

Não sobrescrever nem apagar o fato original para simular correção.

### 6.4 Retenção e LGPD

- Retenção **DEVE** ser definida por categoria de dado e obrigação legal, não por um TTL global arbitrário.
- Direito de eliminação LGPD não implica apagar evidência sujeita a obrigação legal de retenção.
- Quando exclusão física não for permitida, usar anonimização/pseudonimização compatível com a finalidade e a obrigação de retenção.
- Dados pessoais sensíveis ou financeiros devem receber acesso restrito, mascaramento e auditoria proporcional nas fases correspondentes.

---

## 7. Concorrência, integridade e idempotência

### 7.1 Optimistic locking

Entidades mutáveis sujeitas a edição concorrente **DEVEM** usar coluna:

```sql
version BIGINT NOT NULL DEFAULT 1
```

Atualizações devem comparar a versão conhecida e incrementar atomicamente:

```sql
UPDATE ...
SET ..., version = version + 1
WHERE id = $1
  AND version = $2;
```

Zero linhas afetadas representa conflito concorrente e deve ser tratado como conflito de domínio/HTTP 409 quando exposto por API.

### 7.2 Constraints como última linha de integridade

- Invariantes estruturais **DEVEM** ser protegidos por `NOT NULL`, FK, `UNIQUE`, `CHECK` ou exclusão quando o PostgreSQL puder expressá-los corretamente.
- Validação de UI **NÃO** substitui constraint nem validação de backend.
- A aplicação deve traduzir violações esperadas em erros de domínio seguros, sem expor detalhes internos do banco.

### 7.3 Locks transacionais

`SELECT ... FOR UPDATE` ou lock equivalente deve ser usado somente para invariantes realmente concorrentes, como futura reserva exclusiva, aceite único ou liquidação financeira.

Evitar locks amplos e de longa duração. A transação deve ser curta, previsível e possuir estratégia de retry quando necessária.

### 7.4 Idempotência futura

Operações externas críticas, como pagamentos, fiscal, webhooks e contratações, deverão possuir idempotency key, fingerprint de request e resultado persistido conforme a fase 022. A fase 007 define o princípio, mas **NÃO** antecipa sua implementação.

---

## 8. Estados, enums e máquinas de estado

A escolha **DEVE** considerar estabilidade, configurabilidade, necessidade de transição e evolução.

### `CHECK`

Usar quando:

- conjunto é pequeno;
- pertence a uma tabela;
- é estrutural e pouco mutável;
- alteração via migration é aceitável.

### PostgreSQL `ENUM`

Uso excepcional. Somente quando o domínio for extremamente estável, compartilhado e a rigidez do tipo trouxer benefício comprovado. **NÃO É** o padrão para workflows de negócio do TMS.

### Tabela de domínio

Usar quando o valor:

- precisar de metadados;
- puder ser ativado/desativado;
- exigir tradução, ordenação ou configuração;
- for extensível por tenant ou por versão.

### State machine na aplicação

Usar para processos com transições, pré-condições, efeitos e permissões, como futuros ciclos de viagem, contratação, risco, financeiro e fiscal.

A coluna de estado persiste o estado atual, mas a validade da transição **DEVE** ser aplicada pela máquina de estado e por invariantes de banco aplicáveis. Status de processo **NÃO DEVE** ser editável arbitrariamente como CRUD.

---

## 9. Índices e performance

- PostgreSQL não cria índice automaticamente para toda FK; cada FK usada em joins ou filtros recorrentes **DEVE** ser avaliada para indexação.
- Índices **DEVEM** refletir queries reais e invariantes, não uma regra de “indexar tudo”.
- Em tabelas tenant-scoped, `tenant_id` deve participar dos índices que suportam consultas por tenant quando a ordem das colunas for compatível com o padrão de acesso.
- Índices redundantes ou totalmente cobertos por outro índice **NÃO DEVEM** ser mantidos sem motivo.
- Soft delete pode usar índices parciais `WHERE deleted_at IS NULL` para consultas de ativos e unicidade reutilizável.
- Tracking e eventos de alto volume terão estratégia própria de particionamento e retenção na fase correspondente; não antecipar particionamento sem volume/requisito.

---

## 10. JSON, documentos e dados semiestruturados

- `JSONB` **PODE** ser usado para payload externo, metadados evolutivos ou conteúdo cuja estrutura realmente varie.
- `JSONB` **NÃO DEVE** substituir colunas relacionais para atributos centrais, filtros frequentes, FKs ou invariantes estruturais.
- Campos JSONB críticos devem possuir validação de aplicação e, quando adequado, constraints/índices específicos.
- Payload bruto de provider pode ser preservado para reconciliação/auditoria futura, respeitando minimização de dados e retenção.

---

## 11. Regras de migration

Toda migration de domínio a partir da fase 008 deve:

1. declarar escopo da fase e responsabilidade;
2. obedecer naming deste documento;
3. usar tipos nativos PostgreSQL adequados;
4. criar constraints de integridade no mesmo change quando seguro;
5. considerar índices necessários ao acesso tenant-aware;
6. possuir validation SQL correspondente conforme o framework vigente;
7. evitar operação destrutiva sem estratégia explícita de compatibilidade/forward-fix;
8. não introduzir entidade de fase posterior.

Migrations já aplicadas são imutáveis. Correções posteriores devem usar **forward-fix**.

---

## 12. Validação automatizada

A suíte de arquitetura deve bloquear violações verificáveis sem tentar substituir revisão de schema. No baseline atual, os checks cobrem, entre outros:

- presença das decisões normativas deste contrato;
- proibição de `SERIAL` como padrão de identidade de domínio;
- proibição do tipo PostgreSQL `MONEY`;
- colunas `*_at` declaradas como `TIMESTAMPTZ` quando aparecem nas migrations;
- colunas `*_amount` declaradas como `NUMERIC`/`DECIMAL` quando aparecem nas migrations;
- `tenant_id`, quando presente, declarado como `UUID NOT NULL`;
- geração `uuidv7()` para PKs UUID com default de banco nas migrations futuras.

Regex/check automatizado é um guardrail, não um parser SQL completo. Review de migration continua obrigatório.

---

## 13. Checklist de schema review

Antes de aprovar uma migration de domínio, responder:

- Qual é o escopo: global, tenant, empresa ou filial?
- A PK segue o padrão de identificadores?
- Existe chave de negócio? Qual é seu escopo de unicidade?
- FKs impedem referência cross-tenant?
- Datas distinguem instante de data civil?
- Timezone de negócio está explícito quando necessário?
- Dinheiro usa decimal e moeda explícita quando aplicável?
- `version` é necessário para concorrência otimista?
- O registro pode ser apagado? Hard delete, soft delete ou append-only?
- Estado exige `CHECK`, tabela de domínio ou state machine?
- Índices refletem queries e constraints reais?
- Existe risco LGPD, fiscal, financeiro ou de auditoria?
- A validation SQL comprova o resultado da migration?

---

## 14. Decisões congeladas pela fase 007

```text
PK de domínio              = UUID, preferencialmente UUIDv7
Gerador PostgreSQL 18+     = uuidv7()
Business key               = separado da PK
Instantes                  = TIMESTAMPTZ / UTC
Datas civis                = DATE
Timezone de negócio        = IANA
Montante padrão            = NUMERIC(19,4)
Dinheiro em float          = PROIBIDO
PostgreSQL MONEY           = PROIBIDO
Moeda                      = ISO 4217 quando aplicável
Naming PostgreSQL          = snake_case
Tabelas de domínio         = plural
Tenant-scoped              = tenant_id UUID NOT NULL
Unique tenant-aware        = inclui tenant_id quando a regra não for global
FK tenant-aware            = inclui tenant_id quando ambos os lados forem tenant-scoped
Soft delete                = somente quando justificado
Fatos financeiro/fiscal    = append-only + reversão/compensação
Optimistic locking         = version BIGINT quando houver concorrência de edição
PostgreSQL ENUM            = excepcional
Workflow de negócio        = state machine na aplicação
Migrations aplicadas       = imutáveis; correção por forward-fix
```

Este contrato deve ser reutilizado pelas fases 008+ sem antecipar nenhuma entidade de negócio nesta fase.