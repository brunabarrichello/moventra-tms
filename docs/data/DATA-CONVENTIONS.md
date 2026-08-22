# Convenções de Dados — Moventra TMS

## Identificadores
- Preferir UUID ordenável temporalmente quando suportado pela stack escolhida; UUIDv7 é a referência recomendada para novos agregados.
- IDs internos não substituem chaves de negócio e não devem expor sequências previsíveis quando isso criar risco.

## Multi-tenancy
- Entidades pertencentes ao tenant devem carregar `tenant_id` salvo quando houver justificativa arquitetural explícita.
- `company_id` e `branch_id` devem ser usados somente quando a entidade realmente possuir esse escopo.
- Constraints e índices devem considerar o escopo do tenant para unicidade.

## Datas e horários
- Persistir instantes em `TIMESTAMPTZ`/UTC.
- Preservar timezone de negócio quando necessário para agendas, janelas e regras locais.
- Não usar strings para datas quando houver tipo nativo adequado.

## Valores monetários
- Nunca usar ponto flutuante binário para dinheiro.
- Persistir moeda explicitamente quando houver possibilidade multi-moeda.
- Arredondamento deve seguir regra de domínio e ser reproduzível.

## Exclusão e histórico
- Soft delete somente onde houver necessidade real de recuperação/histórico.
- Financeiro, fiscal e trilhas de auditoria não devem ser apagados para representar correções; usar estorno, reversão ou novo evento.

## Concorrência
- Invariantes críticos devem ser protegidos no banco e na transação, não apenas na UI.
- Reservas de motorista/veículo, aceite de proposta e pagamentos exigem proteção contra corrida.

## Auditoria
Operações críticas devem permitir identificar ator, tenant, empresa/filial quando aplicável, ação, entidade, antes/depois, origem, request/correlation ID e momento do evento.

## Índices
- Toda FK usada em joins/filtragem recorrente deve ser avaliada para indexação.
- Índices devem refletir consultas reais; evitar índices redundantes.
- Grandes tabelas de tracking/eventos devem ter estratégia específica de particionamento e retenção.

## Status e estados
Processos relevantes devem usar state machines ou transições validadas; evitar status editáveis arbitrariamente.
