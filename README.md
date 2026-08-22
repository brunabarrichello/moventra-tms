# Moventra TMS — Plataforma SaaS Empresarial de Transporte e Logística

**Produto:** Moventra TMS  
**Descrição:** Plataforma SaaS Empresarial de Gestão e Orquestração de Transportes  
**Nome técnico:** `moventra-tms`  
**Namespace:** `moventra`  
**Identificador curto:** `MVT`  
**API:** `api.moventra.*`

## Aplicações previstas

- `moventra-web`
- `moventra-api`
- `moventra-worker`
- `moventra-driver`
- `moventra-portal`

## Diretrizes arquiteturais

O Moventra TMS é uma plataforma SaaS empresarial multi-tenant, multiempresa e multifilial, com RBAC, auditoria, rastreabilidade, segurança por padrão, LGPD, observabilidade, idempotência e isolamento de dados entre tenants.

A arquitetura inicial adota monólito modular bem estruturado, preparado para evolução orientada por domínios e extração de serviços somente quando sustentada por necessidade operacional e métricas reais.

## Fundação técnica

A fundação versionada está sendo construída na branch `foundation/governance` e inclui governança, arquitetura, ambientes, secrets, convenções de dados, CI e a primeira migration estrutural.

- Migration: `db/migrations/0001_foundation.sql`
- Validação: `db/validation/0001_foundation_validation.sql`
- Escopo da migration 0001: organização, identidade, RBAC e auditoria; sem módulos de negócio.

A promoção do schema para a branch principal do banco somente ocorre após validação em branch temporária e aprovação explícita.

## Integrações de engenharia

- GitHub: código, branches, pull requests, issues e CI/CD
- Neon Postgres: banco PostgreSQL e branches de banco
- Atlassian Rovo: Jira e Confluence
- Vercel: deploy e ambientes web
- Google Drive: documentação e artefatos do projeto
- Sent: SMS, WhatsApp e RCS

> Este repositório está conectado ao projeto Moventra TMS. O nome técnico oficial do produto é `moventra-tms`; a nomenclatura dos repositórios será padronizada conforme a estrutura definitiva de aplicações.
