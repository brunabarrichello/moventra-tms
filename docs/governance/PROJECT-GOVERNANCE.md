# Governança Técnica — Moventra TMS

## Objetivo
Estabelecer regras mínimas obrigatórias para evolução segura, auditável e previsível do Moventra TMS.

## Identidade oficial
- Produto: Moventra TMS
- Nome técnico: `moventra-tms`
- Namespace: `moventra`
- Identificador: `MVT`
- API: `api.moventra.*`

## Princípios obrigatórios
1. SaaS multi-tenant com isolamento entre tenants.
2. Multiempresa e multifilial dentro do tenant.
3. RBAC e autorização crítica sempre no backend.
4. Auditoria, rastreabilidade, histórico e versionamento.
5. Segurança por padrão e LGPD.
6. Integridade transacional, idempotência e controle de concorrência.
7. Observabilidade desde a fundação.
8. Configuração hierárquica por tenant/empresa/filial/usuário quando aplicável.
9. Monólito modular como arquitetura inicial; extração de serviços apenas por necessidade comprovada.

## Fluxo de mudança
- Toda mudança relevante deve partir de branch específica.
- Alterações estruturais devem ser submetidas por Pull Request.
- Decisões arquiteturais relevantes exigem ADR versionado.
- Mudanças de banco devem usar migrations e ambiente/branch de validação antes de produção.
- Nenhum secret deve ser versionado.
- Mudanças críticas devem preservar trilha de auditoria.

## Branches
- `main`: linha estável/canônica.
- `foundation/*`: fundação e governança.
- `feature/*`: funcionalidades.
- `fix/*`: correções.
- `chore/*`: manutenção técnica.
- `release/*`: quando o processo de releases justificar.

## Pull Requests
Cada PR deve declarar:
- objetivo;
- escopo;
- impactos de segurança;
- impactos multi-tenant;
- impactos de dados/migration;
- testes executados;
- estratégia de rollback quando aplicável.

## Gates iniciais
- G1 Foundation Ready: arquitetura, banco, CI/CD e ambientes.
- G2 Security Ready: autenticação, RBAC, isolamento e auditoria.

Nenhum módulo de negócio deve ser considerado pronto antes dos gates estruturais correspondentes.
