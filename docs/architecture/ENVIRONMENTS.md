# Ambientes — Moventra TMS

## Objetivo
Padronizar a separação de ambientes de aplicação, banco, secrets e integrações.

| Ambiente | Finalidade | Banco Neon | Deploy | Dados reais |
|---|---|---|---|---|
| Development | desenvolvimento diário | `development` | a provisionar | proibidos por padrão |
| Test | testes automatizados/efêmeros | branch efêmera ou banco isolado | CI | proibidos |
| Staging | homologação técnica e UAT | `staging` | a provisionar | mascarados/sintéticos por padrão |
| Production | operação real | `main` ou estratégia produtiva aprovada | a provisionar | permitidos sob controles LGPD |

## Regras
- credenciais são exclusivas por ambiente;
- integrações externas devem usar sandbox quando disponível fora de produção;
- produção não deve compartilhar tokens, chaves ou bancos com ambientes inferiores;
- migrations devem ser validadas antes de alcançar produção;
- logs devem evitar dados pessoais e secrets;
- testes automatizados nunca devem depender de produção.

## Estado atual
Neon possui `main`, `development` e `staging`. Os ambientes completos da aplicação ainda não estão provisionados. A escolha de runtime e projetos de deploy será registrada antes do fechamento do G1.
