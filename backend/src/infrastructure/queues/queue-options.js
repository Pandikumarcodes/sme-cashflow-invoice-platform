export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: Object.freeze({ type: 'exponential', delay: 1_000 }),
  removeOnComplete: Object.freeze({ count: 1_000 }),
  removeOnFail: Object.freeze({ count: 5_000 }),
});

export const BULLMQ_CONNECTION_OPTIONS = Symbol('BULLMQ_CONNECTION_OPTIONS');
export const BULLMQ_ROOT_OPTIONS = Symbol('BULLMQ_ROOT_OPTIONS');
