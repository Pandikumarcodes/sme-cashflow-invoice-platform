import { DEFAULT_JOB_OPTIONS } from './queue-options.js';

describe('default BullMQ job options', () => {
  it('uses bounded retries and retained diagnostic history', () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    });
  });
});
