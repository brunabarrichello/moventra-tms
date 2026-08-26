# ADR-0003 — Postura de Rede do Neon PostgreSQL

## Status

**ACCEPTED — risco residual formalmente aceito com controles compensatórios e gatilhos de revisão.**

Data: 2026-08-26.

## Contexto

O Moventra TMS usa Neon PostgreSQL como banco relacional canônico. O endpoint gerenciado é publicamente roteável e protegido por TLS/autenticação do PostgreSQL. Publicamente roteável não significa publicamente autorizado: o acesso depende de credencial válida e das políticas/roles do banco.

Esse modelo simplifica Vercel, Railway, CI e operações multiambiente, porém aumenta a superfície de exposição de rede em relação a conectividade privada/VPC.

## Decisão

No estágio atual da plataforma, o endpoint gerenciado publicamente roteável é **aceito temporariamente** como postura oficial, desde que todos os controles abaixo permaneçam obrigatórios.

Não será criado túnel, proxy ou componente de rede próprio apenas para mascarar o endpoint sem ganho de segurança mensurável.

## Controles obrigatórios

1. **TLS obrigatório** para Staging e Production. Conexão PostgreSQL sem TLS é proibida.
2. **Credenciais segregadas por ambiente**; Staging nunca reutiliza credencial de Production.
3. **Roles dedicadas de menor privilégio** por runtime/capability. Runtime não usa owner/admin e não recebe `BYPASSRLS`.
4. **Secrets somente em secret stores**; `DATABASE_URL`, password e material equivalente nunca são versionados ou registrados em logs/evidências.
5. **RLS continua defesa adicional**, não substituto da autorização backend.
6. **Rotação imediata** em caso de suspeita de exposição, vazamento, mudança de operador ou incidente.
7. **Observabilidade sem DSN**: logs, traces e métricas não podem registrar host+credential, query string sensível ou URL completa de conexão.
8. **Ambientes isolados** por branches/roles/credentials conforme a arquitetura vigente.
9. **Fail closed**: ausência de configuração segura impede promoção; não há fallback para conexão insegura.

## TLS e validação de certificado

A conexão deve preservar validação de certificado/hostname conforme suporte do driver e do provider. Qualquer alteração futura do driver `pg`, pooling ou proxy deverá revalidar explicitamente a semântica TLS antes de promoção.

Se auditoria demonstrar que o runtime deixou de validar adequadamente o certificado/hostname, isso passa a ser finding P1 de segurança e bloqueia release com dados reais.

## IP restrictions / private networking

Não registrar como habilitado qualquer controle que não tenha evidência operacional.

A adoção de IP allowlist, private networking, VPC peering, PrivateLink ou alternativa equivalente deverá ser reavaliada quando pelo menos um dos gatilhos ocorrer:

- entrada de dados pessoais/sensíveis reais em escala comercial;
- exigência contratual de cliente enterprise;
- requisito regulatório/seguradora/auditoria externa;
- disponibilidade de egress estável/privado nos runtimes usados;
- aumento relevante da superfície de acesso administrativo;
- incidente ou finding de segurança relacionado à exposição de rede;
- mudança de SLA/criticidade da plataforma.

## Critério de migração para conectividade privada

A mudança somente será aprovada se:

- suportar Vercel/Railway ou seus runtimes substitutos sem bypass inseguro;
- preservar segregação Staging/Production;
- não exigir credenciais administrativas no runtime;
- possuir estratégia de rollback;
- incluir observabilidade, health check e runbook;
- não criar single point of failure autogerenciado sem necessidade.

## Risco residual aceito

Risco: tentativa de conexão ao endpoint PostgreSQL pode alcançar a superfície pública do provider.

Mitigação vigente: TLS + autenticação forte/segregada + roles least privilege + RLS + secrets management + rotação + observabilidade/redação + pipeline protegido.

O risco é **aceito para a baseline atual**, não eliminado. Deve ser reaberto pelos gatilhos acima.

## Consequências

### Positivas

- conectividade simples e suportada pelos runtimes atuais;
- menor complexidade operacional;
- ausência de proxy/VPN próprio adicional;
- decisão auditável em vez de risco implícito.

### Negativas

- endpoint continua publicamente roteável;
- depende da robustez de TLS, credenciais, provider e controles de banco;
- pode ser insuficiente para contratos enterprise específicos.

## Evidência e revisão

A revisão deste ADR deve ocorrer:

- antes de onboarding comercial que imponha private connectivity;
- após incidente de banco/rede;
- em mudança major do driver PostgreSQL/provider;
- no mínimo em cada revisão macro de segurança da plataforma.
