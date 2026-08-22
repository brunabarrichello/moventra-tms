# ADR-0001 — Monólito Modular como Arquitetura Inicial

- Status: Aceito
- Data: 2026-08-22

## Contexto
O Moventra TMS abrangerá organização, CRM/comercial, operação, motoristas, frota, tracking, risco, documentos, financeiro, fiscal, comunicação, integrações e billing SaaS. A plataforma deve ser escalável e evolutiva sem introduzir complexidade distribuída prematuramente.

## Decisão
Adotar inicialmente um **monólito modular**, organizado por domínios e limites explícitos, com alta coesão e baixo acoplamento.

Os módulos devem expor contratos claros e evitar acesso transversal direto a detalhes internos. Eventos de domínio, outbox, jobs e mensageria poderão ser introduzidos quando necessários sem transformar cada módulo em serviço independente.

## Consequências positivas
- transações locais mais simples;
- menor custo operacional inicial;
- depuração e testes mais previsíveis;
- evolução de domínios sem dependência de infraestrutura distribuída;
- possibilidade de extração futura orientada por métricas.

## Restrições
- módulos não podem compartilhar tabelas indiscriminadamente;
- dependências entre módulos devem ser explícitas;
- shared kernel deve permanecer mínimo;
- regras de tenant e autorização não podem depender da UI;
- tracking massivo e integrações assíncronas devem ser desenhados para futura separação se necessário.

## Critérios para futura extração de serviço
A extração só deve ocorrer com evidência de pelo menos um fator relevante: escala independente, isolamento de falhas, requisitos operacionais distintos, compliance, limites de runtime, frequência de deploy ou ownership claramente separado.
