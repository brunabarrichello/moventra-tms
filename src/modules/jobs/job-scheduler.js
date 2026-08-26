import { performance } from 'node:perf_hooks';
import { normalizeJobScheduleInput } from './job-contract.js';
import { recordJobOperation } from './job-observability.js';

export class JobScheduler {
  constructor({ repository, defaultMaxAttempts = 10 } = {}) {
    if (!repository || typeof repository.enqueue !== 'function') {
      throw new TypeError('JobScheduler requires a repository with enqueue()');
    }
    this.repository = repository;
    this.defaultMaxAttempts = defaultMaxAttempts;
  }

  async schedule(input) {
    const startedAt = performance.now();
    let normalized;
    try {
      normalized = normalizeJobScheduleInput(input, { defaultMaxAttempts: this.defaultMaxAttempts });
      const job = await this.repository.enqueue(normalized);
      recordJobOperation({
        operation: 'schedule', outcome: 'success', jobType: normalized.jobType,
        durationMs: performance.now() - startedAt,
      });
      return job;
    } catch (error) {
      recordJobOperation({
        operation: 'schedule', outcome: 'failed', jobType: normalized?.jobType ?? 'system.unknown',
        durationMs: performance.now() - startedAt,
      });
      throw error;
    }
  }
}
