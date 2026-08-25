import { normalizeJobType } from './job-contract.js';

export class JobHandlerRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register({ jobType, scope, schemaVersions = [1], handler }) {
    const type = normalizeJobType(jobType);
    if (!['tenant', 'system', 'both'].includes(scope)) {
      throw new TypeError('Job handler scope must be tenant, system or both');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Job handler must be a function');
    }
    if (!Array.isArray(schemaVersions) || schemaVersions.length === 0) {
      throw new TypeError('Job handler schemaVersions must be a non-empty array');
    }
    const versions = new Set(schemaVersions.map((value) => {
      const version = Number(value);
      if (!Number.isInteger(version) || version < 1 || version > 32767) {
        throw new TypeError('Job handler schema version is invalid');
      }
      return version;
    }));
    if (this.handlers.has(type)) {
      throw registryError('MVT_JOB_HANDLER_DUPLICATE', 'Job handler is already registered');
    }
    this.handlers.set(type, Object.freeze({ type, scope, versions, handler }));
    return this;
  }

  resolve(job) {
    const type = normalizeJobType(job?.jobType);
    const registration = this.handlers.get(type);
    if (!registration) {
      throw registryError('MVT_JOB_HANDLER_NOT_FOUND', 'Job handler is not registered');
    }
    if (registration.scope !== 'both' && registration.scope !== job.scope) {
      throw registryError('MVT_JOB_HANDLER_SCOPE_REJECTED', 'Job handler scope does not match job scope');
    }
    if (!registration.versions.has(Number(job.schemaVersion))) {
      throw registryError('MVT_JOB_SCHEMA_UNSUPPORTED', 'Job schema version is not supported');
    }
    return registration.handler;
  }

  listTypes() {
    return Object.freeze([...this.handlers.keys()].sort());
  }
}

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
