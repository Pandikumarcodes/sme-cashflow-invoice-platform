import { JOB_CONTEXT_SCHEMA } from './job-context.js';

describe('queue job context contract', () => {
  it('accepts versioned identifiers and correlation metadata', () => {
    expect(
      JOB_CONTEXT_SCHEMA.parse({
        version: 1,
        organizationId: '7ff18a63-34d5-4b7f-b09f-c0f151386cba',
        entityId: '9047b523-d80a-4ae3-a4db-e8342216e4ce',
        requestId: '01K5QXJ2NCMXS8VV7S7E4Z1KZR',
        actorId: '432fc01d-4b09-4888-ab1f-3c622b44b124',
      }),
    ).toBeDefined();
  });

  it('rejects unrecognized payload fields', () => {
    expect(() => JOB_CONTEXT_SCHEMA.parse({ version: 1, authoritativeTotal: '100.00' })).toThrow();
  });
});
