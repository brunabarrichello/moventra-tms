import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { calculateJobBackoff } from './job-backoff.js';
import { recordJobOperation } from './job-observability.js';

export class JobWorker {
  constructor({
    repository,
    registry,
    batchSize = 25,
    concurrency = 5,
    leaseMs = 60000,
    heartbeatMs = 20000,
    idlePollMs = 1000,
    handlerTimeoutMs = 30000,
    retryBaseMs = 1000,
    retryMaxMs = 300000,
    random = Math.random,
  } = {}) {
    if (!repository || typeof repository.claimBatch !== 'function') {
      throw new TypeError('JobWorker requires a durable repository');
    }
    if (!registry || typeof registry.resolve !== 'function') {
      throw new TypeError('JobWorker requires a JobHandlerRegistry');
    }
    this.repository = repository;
    this.registry = registry;
    this.batchSize = boundedInteger(batchSize, 1, 500, 'batchSize');
    this.concurrency = boundedInteger(concurrency, 1, 100, 'concurrency');
    this.leaseMs = boundedInteger(leaseMs, 1000, 3600000, 'leaseMs');
    this.heartbeatMs = boundedInteger(heartbeatMs, 500, Math.max(500, this.leaseMs - 1), 'heartbeatMs');
    this.idlePollMs = boundedInteger(idlePollMs, 100, 60000, 'idlePollMs');
    this.handlerTimeoutMs = boundedInteger(handlerTimeoutMs, 250, 3600000, 'handlerTimeoutMs');
    this.retryBaseMs = boundedInteger(retryBaseMs, 100, 3600000, 'retryBaseMs');
    this.retryMaxMs = boundedInteger(retryMaxMs, this.retryBaseMs, 86400000, 'retryMaxMs');
    this.random = random;
  }

  async runOnce({ signal } = {}) {
    signal?.throwIfAborted?.();
    await this.repository.reapExpiredExhausted?.();
    signal?.throwIfAborted?.();

    const leaseToken = randomUUID();
    const startedAt = performance.now();
    const jobs = await this.repository.claimBatch({
      // Never lease more work than this worker can start immediately. Otherwise jobs waiting
      // in an in-memory chunk can expire before their heartbeat starts and be double-claimed.
      limit: Math.min(this.batchSize, this.concurrency),
      leaseMs: this.leaseMs,
      leaseToken,
    });
    recordJobOperation({
      operation: 'claim', outcome: jobs.length === 0 ? 'empty' : 'success',
      jobType: jobs[0]?.jobType ?? 'system.unknown', durationMs: performance.now() - startedAt,
    });
    if (jobs.length === 0) {
      return Object.freeze({ claimed: 0, succeeded: 0, retryScheduled: 0, failedTerminal: 0 });
    }

    // Once rows are leased, shutdown stops future claims but lets the current bounded batch
    // settle. Killing already leased handlers on SIGTERM would create false terminal failures.
    const results = await Promise.all(jobs.map((job) => this.executeJob(job)));

    return Object.freeze({
      claimed: jobs.length,
      succeeded: results.filter((value) => value === 'success').length,
      retryScheduled: results.filter((value) => value === 'retry').length,
      failedTerminal: results.filter((value) => value === 'failed').length,
    });
  }

  async runForever({ signal } = {}) {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      let result;
      try {
        result = await this.runOnce({ signal });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        throw error;
      }

      if (result.claimed === 0) {
        try {
          await sleep(this.idlePollMs, signal);
        } catch (error) {
          if (signal?.aborted) {
            return;
          }
          throw error;
        }
      }
    }
  }

  async executeJob(job) {
    const startedAt = performance.now();
    let handler;
    try {
      handler = this.registry.resolve(job);
    } catch (error) {
      await this.persistFailure(job, error, false);
      recordJobOperation({
        operation: 'execute', outcome: 'rejected', jobType: job.jobType,
        durationMs: performance.now() - startedAt,
      });
      return 'failed';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(timeoutError()), this.handlerTimeoutMs);
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.repository.heartbeat({
        jobId: job.id,
        leaseToken: job.leaseToken,
        leaseMs: this.leaseMs,
      }).then((owned) => {
        if (!owned) {
          leaseLost = true;
          controller.abort(leaseError());
        }
      }).catch(() => {
        leaseLost = true;
        controller.abort(leaseError());
      });
    }, this.heartbeatMs);

    try {
      await handler(Object.freeze({
        jobId: job.id,
        tenantId: job.tenantId,
        scope: job.scope,
        jobType: job.jobType,
        schemaVersion: job.schemaVersion,
        payload: job.payload,
        metadata: job.metadata,
        attempt: job.attemptCount,
        signal: controller.signal,
      }));
      controller.signal.throwIfAborted?.();
      if (leaseLost) {
        throw leaseError();
      }
      const completed = await this.repository.completeSuccess({ jobId: job.id, leaseToken: job.leaseToken });
      if (!completed) {
        throw leaseError();
      }
      recordJobOperation({
        operation: 'execute', outcome: 'success', jobType: job.jobType,
        durationMs: performance.now() - startedAt,
      });
      return 'success';
    } catch (error) {
      const retryable = error?.retryable === true || error?.code === 'MVT_JOB_LEASE_LOST';
      const persisted = await this.persistFailure(job, error, retryable);
      recordJobOperation({
        operation: retryable ? 'retry' : 'execute',
        outcome: retryable ? 'retryable_error' : 'failed',
        jobType: job.jobType,
        durationMs: performance.now() - startedAt,
      });
      return persisted?.status === 'retry_scheduled' ? 'retry' : 'failed';
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    }
  }

  async persistFailure(job, error, retryable) {
    const delayMs = retryable
      ? calculateJobBackoff({
        attempt: Math.max(1, job.attemptCount),
        baseDelayMs: this.retryBaseMs,
        maxDelayMs: this.retryMaxMs,
        random: this.random,
      })
      : 0;
    const errorCode = safeToken(error?.code, 'MVT_JOB_HANDLER_FAILED');
    const errorClass = retryable ? 'retryable' : 'non_retryable';
    return this.repository.completeFailure({
      jobId: job.id,
      leaseToken: job.leaseToken,
      retryable,
      errorCode,
      errorClass,
      delayMs,
    });
  }
}

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Worker shutdown'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function safeToken(value, fallback) {
  const token = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9_]{3,80}$/.test(token) ? token : fallback;
}

function timeoutError() {
  const error = new Error('Job handler timed out');
  error.code = 'MVT_JOB_HANDLER_TIMEOUT';
  error.retryable = true;
  return error;
}

function leaseError() {
  const error = new Error('Job lease ownership was lost');
  error.code = 'MVT_JOB_LEASE_LOST';
  error.retryable = true;
  return error;
}

function boundedInteger(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}
