# Política de Secrets — Moventra TMS

## Regra principal
Nenhuma senha, token, connection string, chave privada, certificado ou credencial deve ser persistida em código-fonte, documentação pública, issues, logs ou artefatos de build.

## Escopo
Aplica-se a GitHub, Neon/PostgreSQL, Vercel, provedores de comunicação, integrações fiscais, bancos, gateways, mapas, rastreadores, ERPs e quaisquer serviços externos.

## Princípios
- secrets exclusivos por ambiente;
- menor privilégio;
- rotação periódica e imediata após suspeita de exposição;
- revogação de credenciais não utilizadas;
- service accounts separadas de usuários humanos;
- auditoria de alterações e acessos quando o provedor suportar;
- nunca registrar secrets completos em logs;
- variáveis sensíveis não devem ser expostas ao frontend.

## Desenvolvimento local
Usar arquivos locais ignorados pelo Git e fornecer apenas `.env.example` sem valores reais quando a stack de runtime for definida.

## CI/CD
Secrets devem ser fornecidos pelo secret store da plataforma de CI/CD/deploy. Pull Requests de forks ou fontes não confiáveis não devem receber credenciais produtivas.

## Incidente de exposição
1. revogar/rotacionar a credencial;
2. identificar alcance e período;
3. revisar logs e uso indevido;
4. remover o segredo do histórico quando aplicável;
5. registrar incidente e ações corretivas;
6. criar prevenção automatizada para recorrência.
