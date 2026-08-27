# 026 — DLQ Admin APIs — Boundary JWT

## Estado

`IMPLEMENTED / AWAITING CI AND RELEASE EVIDENCE`

Este documento registra o adapter inicial de autenticação HTTP das Admin APIs da fase 026. A decisão canônica de Auth continua provider-agnostic: o core recebe apenas `{ providerKey, issuer, subject }` após verificação criptográfica e resolve `ExternalIdentity → User → Membership → RBAC → scope → RLS`.

## Decisão

O emissor inicial é Neon Auth (Better Auth gerenciado) em um projeto de identidade separado do banco operacional do TMS:

```text
project       = moventra-identity
project_id    = square-hat-88489395
provider_key  = neon-auth
algorithm     = EdDSA / Ed25519
```

A escolha do provider não aparece no verificador HTTP. `src/http/bearer-jwt-assertion.js` continua aceitando contratos JWT assimétricos RS256, ES256 ou EdDSA e pode usar PEM estático ou JWKS HTTPS por `kid`.

## Production

```text
MOVENTRA_AUTH_PROVIDER_KEY=neon-auth
MOVENTRA_AUTH_JWT_ISSUER=https://ep-ancient-bar-afxx0ido.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth
MOVENTRA_AUTH_JWT_AUDIENCE=https://ep-ancient-bar-afxx0ido.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth
MOVENTRA_AUTH_JWT_ALGORITHM=EdDSA
MOVENTRA_AUTH_JWT_JWKS_URL=https://ep-ancient-bar-afxx0ido.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth/.well-known/jwks.json
MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM=<resolved from the public JWKS immediately before protected deploy>
```

## Staging

```text
MOVENTRA_AUTH_PROVIDER_KEY=neon-auth
MOVENTRA_AUTH_JWT_ISSUER=https://ep-dark-firefly-afly55jq.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth
MOVENTRA_AUTH_JWT_AUDIENCE=https://ep-dark-firefly-afly55jq.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth
MOVENTRA_AUTH_JWT_ALGORITHM=EdDSA
MOVENTRA_AUTH_JWT_JWKS_URL=https://ep-dark-firefly-afly55jq.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth/.well-known/jwks.json
MOVENTRA_AUTH_JWT_PUBLIC_KEY_PEM=<resolved from the public JWKS immediately before governed deploy>
```

O PEM é público, mas não é congelado manualmente: `scripts/release/resolve-auth-provider.mjs` consulta o JWKS, valida apenas Ed25519 público e converte o JWK atual para SPKI PEM. `scripts/release/sync-auth-env-to-vercel.sh` sincroniza o snapshot PEM e o JWKS URL. Com JWKS configurado, o runtime resolve a signing key pelo `kid`, permitindo rotação governada sem private key no Moventra.

## Private key

A private signing key permanece exclusivamente no IdP. O Moventra não possui variável `MOVENTRA_AUTH_JWT_PRIVATE_KEY`, não lê `neon_auth.jwks.privateKey`, não versiona PEM privado e não transfere signing secret para Vercel/GitHub/Railway.

## Fail-closed

A Admin API rejeita a requisição quando ocorrer qualquer uma destas condições:

- configuração de provider/issuer/audience ausente;
- JWT sem assinatura válida;
- `alg` diferente do permitido;
- issuer/audience inválidos;
- `sub` ausente;
- token expirado ou fora de `nbf/iat` tolerado;
- JWKS indisponível;
- `kid` ausente/desconhecido;
- JWKS sem chave pública compatível.

O JWKS precisa ser HTTPS sem credentials/fragment, redirects são rejeitados, o key set é limitado e fica em cache por tempo limitado.

## Release

O script canônico `scripts/release/vercel-deploy-artifact.sh`, usado pelos gates de Staging e Production, executa a sincronização do trust contract antes de criar o deployment. Se a consulta JWKS ou a atualização das variáveis falhar, o deploy não inicia.

## Critério de conclusão

A configuração só passa para `PRODUCTION EVIDENCED` após:

1. CI do SHA exato validar o endpoint JWKS público;
2. Staging receber as variáveis e servir as Admin APIs com autenticação real;
3. evidência de Tenant/RBAC/Idempotency/If-Match/Audit;
4. rollback/restore verde;
5. Production Promotion protegida e aprovada por reviewer humano;
6. smoke autenticado em Production;
7. sincronização GitHub/Confluence.
