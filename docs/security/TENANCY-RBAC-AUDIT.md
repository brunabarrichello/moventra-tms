# Fundação de Segurança — Tenant, Escopo, RBAC e Auditoria

## Hierarquia organizacional
`Tenant → Empresa → Filial`

O tenant é a fronteira primária de isolamento. Empresas e filiais são escopos organizacionais internos do tenant, não substitutos do tenant.

## Entidades estruturais iniciais
- tenants;
- companies;
- branches;
- users;
- memberships;
- roles;
- permissions;
- role_permissions;
- membership_roles (ou associação equivalente);
- audit_logs.

## Membership
Usuário e tenant devem ser relacionados por membership explícito, permitindo que uma mesma identidade possa, quando autorizado, participar de diferentes tenants sem compartilhar dados entre eles.

A membership pode possuir escopo por empresa/filial conforme necessidade do papel.

## Autorização
A autorização deve combinar:
1. identidade autenticada;
2. tenant ativo;
3. membership válida;
4. permissões do papel;
5. escopo organizacional;
6. regras específicas do recurso/domínio.

Nenhuma autorização crítica deve depender somente do frontend.

## RBAC
Roles agrupam permissions. Permissions representam ações atômicas de negócio, por exemplo `operations.trip.read`, `operations.trip.update` ou `finance.payment.approve`.

Papéis padrão poderão ser fornecidos como templates, mas tenants devem poder receber configuração controlada sem comprometer invariantes da plataforma.

## Isolamento
Toda consulta a dados tenant-owned deve ser limitada pelo `tenant_id` no backend/repositório. RLS será avaliada como defesa adicional, nunca como substituta da autorização de aplicação.

Testes automatizados devem validar Tenant A × Tenant B em leituras e escritas.

## Auditoria
A trilha de auditoria deve registrar, quando aplicável:
- `tenant_id`;
- `company_id`;
- `branch_id`;
- ator e tipo do ator;
- ação;
- entidade e identificador;
- estado anterior e posterior;
- origem;
- IP/user agent quando disponível;
- `request_id`;
- `correlation_id`;
- justificativa para operações sensíveis;
- data/hora.

## Separação de trilhas
- Audit Trail: mudanças de negócio;
- Security Audit: autenticação, privilégios, bloqueios e acessos suspeitos;
- Operational Event Log: eventos operacionais de carga/viagem/tracking;
- Financial/Fiscal Ledger: eventos imutáveis ou reversíveis por lançamento compensatório.

## Próxima etapa de implementação
Após aprovação da fundação documental, o schema inicial deve ser preparado em branch/migration de banco e validado antes de alcançar `main`.
