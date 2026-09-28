import { randomUUID } from 'node:crypto';

import { Worker } from 'bullmq';

import { QueueFactory } from '../../src/infrastructure/queues/queue.factory.js';
import { QUEUE_NAMES } from '../../src/infrastructure/queues/queue-names.js';
import { DEFAULT_JOB_OPTIONS } from '../../src/infrastructure/queues/queue-options.js';
import { RedisConnection } from '../../src/infrastructure/redis/redis.connection.js';

const redisConfig = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  db: Number(process.env.REDIS_DB ?? 0),
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
};
const prefix = `${process.env.QUEUE_PREFIX ?? 'sme-test'}:${randomUUID()}`;

describe('Redis and BullMQ integration', () => {
  let redis;
  let queue;
  let queueFactory;
  let worker;
  let connection;

  beforeAll(async () => {
    redis = new RedisConnection({ getOrThrow: () => redisConfig });
    await redis.ping();
    connection = redis.getConnectionOptions({ maxRetriesPerRequest: null });
    queueFactory = new QueueFactory({
      connection,
      prefix,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queue = queueFactory.getQueue(QUEUE_NAMES.INFRASTRUCTURE_SMOKE);
  });

  afterAll(async () => {
    if (worker) await worker.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queueFactory.onModuleDestroy();
    }
    await redis?.onModuleDestroy();
  });

  it('pings Redis', async () => {
    await expect(redis.ping()).resolves.toBeUndefined();
  });

  it('enqueues and consumes an isolated smoke job with central defaults', async () => {
    const completed = new Promise((resolve, reject) => {
      worker = new Worker(
        QUEUE_NAMES.INFRASTRUCTURE_SMOKE,
        async (job) => ({ received: job.data.value }),
        { connection, prefix },
      );
      worker.once('completed', resolve);
      worker.once('failed', (_job, error) => reject(error));
    });

    const job = await queue.add('round-trip', { value: 'smoke' });
    expect(job.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    });

    const completedJob = await completed;
    expect(completedJob.returnvalue).toEqual({ received: 'smoke' });
  });
});
