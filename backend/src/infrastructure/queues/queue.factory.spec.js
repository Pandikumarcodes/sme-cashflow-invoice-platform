import { QueueFactory } from './queue.factory.js';

describe('QueueFactory', () => {
  it('rejects queue names outside the canonical catalog', () => {
    const factory = new QueueFactory({});
    expect(() => factory.getQueue('raw-business-queue')).toThrow(
      'Queue name must use the canonical queue-name catalog',
    );
  });

  it('has a no-op graceful shutdown before any queue is requested', async () => {
    const factory = new QueueFactory({});
    await expect(factory.onModuleDestroy()).resolves.toBeUndefined();
  });
});
