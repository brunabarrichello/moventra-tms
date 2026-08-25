export const ERROR_CATEGORIES = Object.freeze({
  VALIDATION: 'VALIDATION',
  DOMAIN_RULE: 'DOMAIN_RULE',
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CONCURRENCY: 'CONCURRENCY',
  RATE_LIMIT: 'RATE_LIMIT',
  DEPENDENCY: 'DEPENDENCY',
  TIMEOUT: 'TIMEOUT',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  UNEXPECTED: 'UNEXPECTED',
});

export const ERROR_CODES = Object.freeze({
  VALIDATION_INVALID_INPUT: 'VALIDATION.INVALID_INPUT',
  DOMAIN_RULE_VIOLATION: 'DOMAIN.RULE_VIOLATION',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION.REQUIRED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION.DENIED',
  RESOURCE_NOT_FOUND: 'RESOURCE.NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE.CONFLICT',
  CONCURRENCY_VERSION_MISMATCH: 'CONCURRENCY.VERSION_MISMATCH',
  CONCURRENCY_SERIALIZATION_FAILURE: 'CONCURRENCY.SERIALIZATION_FAILURE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT.EXCEEDED',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY.UNAVAILABLE',
  DEPENDENCY_TIMEOUT: 'DEPENDENCY.TIMEOUT',
  INFRASTRUCTURE_FAILURE: 'INFRASTRUCTURE.FAILURE',
  INTERNAL_UNEXPECTED: 'INTERNAL.UNEXPECTED',
  HTTP_METHOD_NOT_ALLOWED: 'HTTP.METHOD_NOT_ALLOWED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY.KEY_REQUIRED',
  IDEMPOTENCY_REQUEST_MISMATCH: 'IDEMPOTENCY.REQUEST_MISMATCH',
  IDEMPOTENCY_RESULT_UNAVAILABLE: 'IDEMPOTENCY.RESULT_UNAVAILABLE',
});

export const ERROR_DEFINITIONS = Object.freeze({
  [ERROR_CODES.VALIDATION_INVALID_INPUT]: Object.freeze({
    category: ERROR_CATEGORIES.VALIDATION,
    title: 'Entrada inválida',
    publicMessage: 'A requisição contém dados inválidos.',
  }),
  [ERROR_CODES.DOMAIN_RULE_VIOLATION]: Object.freeze({
    category: ERROR_CATEGORIES.DOMAIN_RULE,
    title: 'Regra de negócio não atendida',
    publicMessage: 'A operação não é permitida no estado atual.',
  }),
  [ERROR_CODES.AUTHENTICATION_REQUIRED]: Object.freeze({
    category: ERROR_CATEGORIES.AUTHENTICATION,
    title: 'Autenticação necessária',
    publicMessage: 'Autenticação válida é necessária para esta operação.',
  }),
  [ERROR_CODES.AUTHORIZATION_DENIED]: Object.freeze({
    category: ERROR_CATEGORIES.AUTHORIZATION,
    title: 'Acesso negado',
    publicMessage: 'Você não possui permissão para executar esta operação.',
  }),
  [ERROR_CODES.RESOURCE_NOT_FOUND]: Object.freeze({
    category: ERROR_CATEGORIES.NOT_FOUND,
    title: 'Recurso não encontrado',
    publicMessage: 'O recurso solicitado não foi encontrado.',
  }),
  [ERROR_CODES.RESOURCE_CONFLICT]: Object.freeze({
    category: ERROR_CATEGORIES.CONFLICT,
    title: 'Conflito de recurso',
    publicMessage: 'A operação conflita com o estado atual do recurso.',
  }),
  [ERROR_CODES.CONCURRENCY_VERSION_MISMATCH]: Object.freeze({
    category: ERROR_CATEGORIES.CONCURRENCY,
    title: 'Conflito de concorrência',
    publicMessage: 'O recurso foi alterado por outra operação. Atualize os dados e tente novamente.',
  }),
  [ERROR_CODES.CONCURRENCY_SERIALIZATION_FAILURE]: Object.freeze({
    category: ERROR_CATEGORIES.CONCURRENCY,
    title: 'Conflito transacional',
    publicMessage: 'A operação não pôde ser concluída devido a concorrência transacional.',
  }),
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: Object.freeze({
    category: ERROR_CATEGORIES.RATE_LIMIT,
    title: 'Limite excedido',
    publicMessage: 'O limite de requisições foi excedido.',
  }),
  [ERROR_CODES.DEPENDENCY_UNAVAILABLE]: Object.freeze({
    category: ERROR_CATEGORIES.DEPENDENCY,
    title: 'Dependência indisponível',
    publicMessage: 'Uma dependência necessária está temporariamente indisponível.',
  }),
  [ERROR_CODES.DEPENDENCY_TIMEOUT]: Object.freeze({
    category: ERROR_CATEGORIES.TIMEOUT,
    title: 'Tempo limite excedido',
    publicMessage: 'Uma dependência não respondeu dentro do tempo esperado.',
  }),
  [ERROR_CODES.INFRASTRUCTURE_FAILURE]: Object.freeze({
    category: ERROR_CATEGORIES.INFRASTRUCTURE,
    title: 'Falha de infraestrutura',
    publicMessage: 'A operação não pôde ser concluída devido a uma falha interna.',
  }),
  [ERROR_CODES.INTERNAL_UNEXPECTED]: Object.freeze({
    category: ERROR_CATEGORIES.UNEXPECTED,
    title: 'Erro interno',
    publicMessage: 'Ocorreu um erro interno inesperado.',
  }),
  [ERROR_CODES.HTTP_METHOD_NOT_ALLOWED]: Object.freeze({
    category: ERROR_CATEGORIES.VALIDATION,
    title: 'Método não permitido',
    publicMessage: 'O método HTTP não é permitido para este recurso.',
  }),
  [ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED]: Object.freeze({
    category: ERROR_CATEGORIES.VALIDATION,
    title: 'Chave de idempotência necessária',
    publicMessage: 'Uma Idempotency-Key válida é necessária para esta operação.',
  }),
  [ERROR_CODES.IDEMPOTENCY_REQUEST_MISMATCH]: Object.freeze({
    category: ERROR_CATEGORIES.CONFLICT,
    title: 'Conflito de idempotência',
    publicMessage: 'A Idempotency-Key já foi utilizada para uma intenção de requisição diferente.',
  }),
  [ERROR_CODES.IDEMPOTENCY_RESULT_UNAVAILABLE]: Object.freeze({
    category: ERROR_CATEGORIES.INFRASTRUCTURE,
    title: 'Resultado idempotente indisponível',
    publicMessage: 'O resultado idempotente não está disponível para replay seguro.',
  }),
});

export function getErrorDefinition(code) {
  return ERROR_DEFINITIONS[code] ?? ERROR_DEFINITIONS[ERROR_CODES.INTERNAL_UNEXPECTED];
}
