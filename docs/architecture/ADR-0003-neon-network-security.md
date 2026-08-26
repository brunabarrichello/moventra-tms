# ADR-0003 — Postura de rede do Neon PostgreSQL

## Status

**ACCEPTED WITH TIME-BOUNDED RISK / HARDENING REQUIRED BEFORE SENSITIVE BUSINESS DATA**

Data da decisão: 2026-08-26.

## Contexto

O Moventra TMS utiliza Neon PostgreSQL como banco relacional da plataforma. A auditoria pós-fase 025 revalidou o projeto `moventra-tms` (`shiny-mode-01639948`) em `aws-us-east-1`, PostgreSQL 18.

Configuração observada no momento da decisão:

```text
block_public_connections = false
allowed_ips.ips = []
allowed_ips.protected_branches_only = false
block_vpc_connections = false
```

Isto significa que o endpoint não possui restrição de origem por allowlist de IP no nível do projeto. O acesso continua dependendo de TLS/autenticação PostgreSQL e das credenciais de runtime, mas a superfície de rede é mais ampla do que o estado-alvo para uma plataforma TMS com dados comerciais, pessoais, financeiros e fiscais.

## Decisão

A postura atual é **temporariamente aceita somente para a baseline de fundação 001–025**, porque:

1. o banco ainda não contém dados operacionais/comerciais reais do TMS;
2. runtimes usam roles dedicadas de menor privilégio;
3. roles de aplicação/worker são non-owner, non-superuser e `NOBYPASSRLS`;
4. RLS, RBAC, auditoria e segregação de secrets já existem;
5. conexões de aplicação devem permanecer criptografadas;
6. alterar a conectividade sem validar Vercel, Railway e caminhos de CI pode causar indisponibilidade.

A aceitação é **time-bounded** e não constitui estado final de segurança.

## Estado-alvo

Antes da entrada de dados sensíveis ou da preparação de go-live funcional, deve ser selecionada e validada uma das estratégias:

### Opção A — Private/VPC connectivity

Preferida quando o plano/arquitetura de Neon e os runtimes Vercel/Railway suportarem conectividade privada de forma operacionalmente estável.

**Vantagens:** menor superfície pública e controle de rede mais forte.  
**Limitações:** custo, disponibilidade por plano/provider e complexidade entre múltiplos runtimes.

### Opção B — Allowlist de egress estático

Aceitável se Vercel/Railway oferecerem egress estático confiável para os ambientes necessários.

**Vantagens:** redução direta da superfície.  
**Limitações:** dependência de IPs fixos, gestão de rotação e risco de indisponibilidade em mudanças de egress.

### Opção C — Endpoint público endurecido

Somente quando A/B não forem viáveis, com controles compensatórios fortes e risco formalmente reavaliado.

Controles mínimos:

- TLS com validação estrita de certificado/hostname;
- credenciais dedicadas por ambiente e runtime;
- rotação periódica e imediata em incidente;
- roles `NOBYPASSRLS`, não owner e sem DDL para runtime;
- nenhuma credencial em source/logs;
- monitoring de autenticação/conexões e alertas;
- rate/connection limits apropriados;
- política de resposta a credencial comprometida.

## Critério de saída deste risco

Este ADR deve ser reaberto antes de qualquer uma das condições abaixo:

- carga de dados reais de clientes/motoristas;
- informações bancárias/financeiras/fiscais;
- documentos pessoais;
- abertura de portais externos;
- UAT com dados não sintéticos;
- gate final de Security/Production Readiness.

O aceite definitivo exige evidência de conectividade dos runtimes legítimos e negativa para origens não autorizadas, sem quebrar Staging/Production.

## Não decisão

Este ADR **não autoriza**:

- uso de `neondb_owner` como runtime;
- `BYPASSRLS`;
- desabilitar TLS;
- compartilhar a mesma credencial entre ambientes;
- expor `DATABASE_URL` em documentação/logs;
- alterar regras de rede diretamente em Production sem teste e plano de rollback.

## Impacto na fase 026

A postura atual não bloqueia desenvolvimento isolado da DLQ, mas nenhuma mudança de rede será acoplada à migration 026. O hardening de rede deve continuar como trilha de segurança independente e obrigatória antes de dados sensíveis/go-live funcional.
