import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { QueueFactory } from '../../src/infrastructure/queues/queue.factory.js';
import { QUEUE_NAMES } from '../../src/infrastructure/queues/queue-names.js';
import { DEFAULT_JOB_OPTIONS } from '../../src/infrastructure/queues/queue-options.js';
import { PendingEventDispatcher } from '../../src/infrastructure/queues/pending-event-dispatcher.js';
import { RedisConnection } from '../../src/infrastructure/redis/redis.connection.js';
import { NotificationWorkers } from '../../src/modules/notifications/processors/notification-workers.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';
import { notificationFixture, reminderEvents, eventJob } from '../helpers/notification-fixture.js';

// Queue integration now also exercises PG. Never inherit a development target.
if (!process.env.DATABASE_URL_TEST)
  throw new Error('DATABASE_URL_TEST is required for notification queue tests.');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
jest.setTimeout(30000);
describe('notification BullMQ workers with durable PostgreSQL state', () => {
  const prisma = createTestPrismaClient();
  let redis, queues, runtime, fixture;
  const names = [
    QUEUE_NAMES.EVENTS_DISPATCH,
    QUEUE_NAMES.REMINDERS_SCAN,
    QUEUE_NAMES.REMINDERS_DELIVER,
    QUEUE_NAMES.NOTIFICATIONS_EMAIL,
  ];
  async function eventually(check) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Expected durable worker outcome was not observed.');
  }
  beforeAll(async () => {
    await clearDatabase(prisma);
    fixture = await notificationFixture(prisma, 'queue-notifications', {
      policy: { emailProvider: 'capture' },
    });
    redis = new RedisConnection({
      getOrThrow: () => ({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: Number(process.env.REDIS_DB ?? 0),
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
      }),
    });
    await redis.ping();
    const root = {
      connection: redis.getConnectionOptions({ maxRetriesPerRequest: null }),
      prefix: `notification-test:${randomUUID()}`,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, backoff: { type: 'exponential', delay: 20 } },
    };
    queues = new QueueFactory(root);
    runtime = new NotificationWorkers(
      queues,
      root,
      new PendingEventDispatcher(fixture.provider, queues),
      fixture.reminders,
      fixture.config,
      fixture.provider,
    );
    await runtime.onModuleInit();
  });
  afterAll(async () => {
    if (runtime) await runtime.onModuleDestroy();
    if (queues) {
      for (const name of names) await queues.getQueue(name).obliterate({ force: true });
      await queues.onModuleDestroy();
    }
    await redis?.onModuleDestroy();
    await prisma.$disconnect();
  });
  it('registers canonical queues/jobs and dispatches committed events into durable notifications/deliveries', async () => {
    await eventually(
      async () =>
        (await prisma.reminderDelivery.count({
          where: { organizationId: fixture.org.id, status: 'SENT' },
        })) === 2,
    );
    expect(
      await prisma.notification.count({
        where: { organizationId: fixture.org.id, type: 'INVOICE_OVERDUE' },
      }),
    ).toBe(1);
    expect(await queues.getQueue(QUEUE_NAMES.REMINDERS_SCAN).getJobSchedulers()).toHaveLength(1);
    expect(await queues.getQueue(QUEUE_NAMES.EVENTS_DISPATCH).getJobSchedulers()).toHaveLength(1);
    for (const name of [QUEUE_NAMES.REMINDERS_DELIVER, QUEUE_NAMES.NOTIFICATIONS_EMAIL]) {
      const jobs = await queues.getQueue(name).getJobs(['completed']);
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs[0].name).toBe('event');
      expect(Object.keys(jobs[0].data).sort()).toEqual(['eventId', 'organizationId', 'version']);
      expect(jobs[0].opts.attempts).toBe(3);
    }
  });
  it('processes duplicate delivery jobs without changing a completed ledger or creating another notification', async () => {
    const event = (await reminderEvents(prisma, fixture)).find(
      (row) => row.payload.channel === 'IN_APP',
    );
    const before = await prisma.reminderDelivery.findMany({
      where: { organizationId: fixture.org.id },
      orderBy: { id: 'asc' },
    });
    const job = await queues.getQueue(QUEUE_NAMES.REMINDERS_DELIVER).add('event', eventJob(event));
    await eventually(async () => (await job.getState()) === 'completed');
    expect(
      await prisma.reminderDelivery.findMany({
        where: { organizationId: fixture.org.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      await prisma.notification.count({
        where: { organizationId: fixture.org.id, type: 'INVOICE_OVERDUE' },
      }),
    ).toBe(1);
  });
  it('rejects malformed jobs permanently and retries transient delivery failures with durable attempt counts', async () => {
    const malformed = await queues
      .getQueue(QUEUE_NAMES.NOTIFICATIONS_EMAIL)
      .add('event', { version: 1, balance: 'spoofed' });
    await eventually(async () => (await malformed.getState()) === 'failed');
    expect(
      (await queues.getQueue(QUEUE_NAMES.NOTIFICATIONS_EMAIL).getJob(malformed.id)).failedReason,
    ).toBe('INVALID_JOB_PAYLOAD');
    const second = await notificationFixture(prisma, 'queue-retry', {
      policy: { emailProvider: 'capture' },
    });
    await second.reminders.scan();
    const event = (await reminderEvents(prisma, second)).find(
      (row) => row.payload.channel === 'EMAIL',
    );
    let attempts = 0;
    const originalEmail = fixture.reminders.email;
    fixture.reminders.email = {
      send: async () => {
        attempts++;
        return attempts < 3
          ? { outcome: 'RETRY' }
          : { outcome: 'SENT', providerMessageId: 'retry-success' };
      },
    };
    try {
      const job = await queues
        .getQueue(QUEUE_NAMES.NOTIFICATIONS_EMAIL)
        .add('event', eventJob(event), { backoff: { type: 'exponential', delay: 20 } });
      await eventually(async () => (await job.getState()) === 'completed');
      expect(
        await prisma.reminderDelivery.findFirst({
          where: { organizationId: second.org.id, id: event.aggregateId },
        }),
      ).toMatchObject({ status: 'SENT', attemptCount: 3, providerMessageId: 'retry-success' });
      expect(attempts).toBe(3);
    } finally {
      fixture.reminders.email = originalEmail;
    }
  });
});
