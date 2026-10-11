import { jest } from '@jest/globals';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { NotificationWorkers } from '../../src/modules/notifications/processors/notification-workers.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { BULLMQ_ROOT_OPTIONS } from '../../src/infrastructure/queues/queue-options.js';
import { QueueFactory } from '../../src/infrastructure/queues/queue.factory.js';
import { QUEUE_NAMES } from '../../src/infrastructure/queues/queue-names.js';
import { DEFAULT_JOB_OPTIONS } from '../../src/infrastructure/queues/queue-options.js';
import { PendingEventDispatcher } from '../../src/infrastructure/queues/pending-event-dispatcher.js';
import { RedisConnection } from '../../src/infrastructure/redis/redis.connection.js';
import { ReportWorkers } from '../../src/modules/reports/processors/report-workers.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';
import { notificationFixture } from '../helpers/notification-fixture.js';
import { reportFixture, command, exportJob } from '../helpers/report-fixture.js';

if (!process.env.DATABASE_URL_TEST)
  throw new Error('DATABASE_URL_TEST is required for report queue tests.');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
jest.setTimeout(30000);
describe('Report BullMQ execution with durable PostgreSQL state and real artifacts', () => {
  const prisma = createTestPrismaClient();
  let redis, queues, runtime, fixture, reports;
  async function eventually(check) {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Expected durable report outcome was not observed.');
  }
  beforeAll(async () => {
    await clearDatabase(prisma);
    fixture = await notificationFixture(prisma, 'report-queue');
    reports = reportFixture(fixture);
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
      prefix: `report-test:${randomUUID()}`,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, backoff: { type: 'exponential', delay: 20 } },
    };
    queues = new QueueFactory(root);
    runtime = new ReportWorkers(
      queues,
      root,
      new PendingEventDispatcher(fixture.provider, queues),
      reports.generation,
    );
    await runtime.onModuleInit();
  });
  afterAll(async () => {
    await runtime?.onModuleDestroy();
    if (queues) {
      await queues.getQueue(QUEUE_NAMES.REPORTS_GENERATE).obliterate({ force: true });
      await queues.onModuleDestroy();
    }
    await redis?.onModuleDestroy();
    await reports?.cleanup();
    await prisma.$disconnect();
  });
  it('dispatches a committed event, generates the artifact, and treats duplicate executions as completed replays', async () => {
    const { data } = await reports.reports.request(fixture.tenant, command('CASH_FLOW'));
    await eventually(
      async () =>
        (
          await prisma.reportExport.findFirst({
            where: { id: data.id, organizationId: fixture.org.id },
          })
        ).status === 'READY',
    );
    expect((await reports.reports.download(fixture.tenant, data.id)).bytes.toString()).toContain(
      'netCashFlow',
    );
    const before = await prisma.reportExport.findFirst({
      where: { id: data.id, organizationId: fixture.org.id },
    });
    const queue = queues.getQueue(QUEUE_NAMES.REPORTS_GENERATE);
    const job = await queue.add('event', await exportJob(prisma, data));
    await eventually(async () => (await job.getState()) === 'completed');
    expect(
      await prisma.reportExport.findFirst({
        where: { id: data.id, organizationId: fixture.org.id },
      }),
    ).toEqual(before);
    expect(Object.keys(job.data).sort()).toEqual(['eventId', 'organizationId', 'version']);
    expect(job.opts.attempts).toBe(3);
    expect(await queue.getJobSchedulers()).toHaveLength(1);
  });
  it('rejects malformed jobs permanently and retries storage outages against the same durable export', async () => {
    const queue = queues.getQueue(QUEUE_NAMES.REPORTS_GENERATE);
    const malformed = await queue.add('event', { version: 1, path: '../../secret' });
    await eventually(async () => (await malformed.getState()) === 'failed');
    expect((await queue.getJob(malformed.id)).failedReason).toBe('INVALID_REPORT_JOB');
    const original = reports.storage.write.bind(reports.storage);
    let calls = 0;
    reports.storage.write = async (...args) => {
      if (++calls < 3) throw new Error('transient storage outage');
      return original(...args);
    };
    const { data } = await reports.reports.request(fixture.tenant, command('CASH_FLOW'));
    await eventually(
      async () =>
        (
          await prisma.reportExport.findFirst({
            where: { id: data.id, organizationId: fixture.org.id },
          })
        ).status === 'READY',
    );
    expect(calls).toBe(3);
    expect(
      await prisma.reportExport.count({ where: { organizationId: fixture.org.id, id: data.id } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { organizationId: fixture.org.id, relatedEntityId: data.id },
      }),
    ).toBe(1);
  });
  it('boots and gracefully closes the combined Nest worker composition with a private test queue namespace', async () => {
    // Direct queue tests need no JWT keys; the composed auth module does. Supply
    // ephemeral test-only keys before loading ConfigurationModule.
    const previous = [
      process.env.AUTH_ACCESS_PRIVATE_KEY_BASE64,
      process.env.AUTH_ACCESS_PUBLIC_KEY_BASE64,
    ];
    const keys = generateKeyPairSync('ed25519');
    process.env.AUTH_ACCESS_PRIVATE_KEY_BASE64 = keys.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    process.env.AUTH_ACCESS_PUBLIC_KEY_BASE64 = keys.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    const { WorkerModule } = await import('../../src/worker.module.js');
    const bootRoot = { ...queues.rootOptions, prefix: `report-boot:${randomUUID()}` };
    const app = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PrismaService)
      .useValue(fixture.provider)
      .overrideProvider(BULLMQ_ROOT_OPTIONS)
      .useValue(bootRoot)
      .compile();
    try {
      await app.init();
      expect(app.get(NotificationWorkers).workers).toHaveLength(4);
      expect(app.get(ReportWorkers).worker.isRunning()).toBe(true);
    } finally {
      await app.close();
      for (const name of [
        QUEUE_NAMES.EVENTS_DISPATCH,
        QUEUE_NAMES.REMINDERS_SCAN,
        QUEUE_NAMES.REMINDERS_DELIVER,
        QUEUE_NAMES.NOTIFICATIONS_EMAIL,
        QUEUE_NAMES.REPORTS_GENERATE,
      ]) {
        const queue = new Queue(name, bootRoot);
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queue.close();
        }
      }
      for (const [index, name] of [
        'AUTH_ACCESS_PRIVATE_KEY_BASE64',
        'AUTH_ACCESS_PUBLIC_KEY_BASE64',
      ].entries()) {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      }
    }
  });
});
