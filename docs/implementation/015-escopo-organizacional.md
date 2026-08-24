# 015 — Escopo Organizacional

## Estado

`ACTIVE / BATCH 012–017`

Production permanece deferida até a conclusão técnica da 017.

## Objetivo

Aplicar as permissões RBAC a alvos organizacionais explícitos dentro do Tenant, sem confiar em IDs fornecidos pelo cliente.

## Hierarquia

```text
TENANT
└── COMPANY
    └── BRANCH
```

`security.organizational_scopes` materializa um alvo válido com FKs compostas que provam a mesma fronteira de Tenant. `security.role_assignment_scopes` liga a atribuição RBAC a um ou mais alvos.

## Semântica de cobertura

- escopo TENANT cobre qualquer Empresa/Filial do mesmo Tenant;
- escopo COMPANY cobre a Empresa e suas Filiais;
- escopo BRANCH cobre somente a Filial exata;
- atribuição sem escopo não concede acesso a recurso organizacional;
- recurso deve ser carregado pelo backend e seu escopo efetivo derivado dos dados persistidos.

## Segurança

A autorização combina User/Membership operacionais, RBAC ativo e escopo organizacional. Nenhum UUID isolado é tratado como autorização. Cross-tenant e cross-company são impedidos por constraints, queries tenant-aware e testes.

## Não escopo

RLS/defesa adicional = 016; Auditoria Central = 017.

## Gate técnico

Migration/validation, domínio/repository, testes de hierarquia e CI verdes, seguidos de Neon Staging. Conclusão formal ocorre somente após o deploy Production final do batch.
