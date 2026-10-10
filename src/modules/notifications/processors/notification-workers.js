import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError, Worker } from 'bullmq';
import { QueueFactory } from '../../../infrastructure/queues/queue.factory.js';
import { PendingEventDispatcher } from '../../../infrastructure/queues/pending-event-dispatcher.js';
import { BULLMQ_ROOT_OPTIONS } from '../../../infrastructure/queues/queue-options.js';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue-names.js';
import { EVENT_JOB_SCHEMA, EVENT_TYPES, SCAN_JOB_SCHEMA } from '../domain/reminder.js';
import { RemindersService } from '../application/reminders.service.js';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class NotificationWorkers {
  workers = [];
  logger = new Logger(NotificationWorkers.name);
  constructor(queues, root, dispatcher, reminders, config, persistence) {
    this.queues = queues;
    this.root = root;
    this.dispatcher = dispatcher;
    this.reminders = reminders;
    this.concurrency = config.getOrThrow('notification').workerConcurrency;
    this.persistence = persistence;
  }
  async onModuleInit() {
    const client = await this.persistence.getClient();
    await client.$queryRaw`SELECT 1`;
    await this.queues.getQueue(QUEUE_NAMES.EVENTS_DISPATCH).waitUntilReady();
    for (const name of [
      QUEUE_NAMES.EVENTS_DISPATCH,
      QUEUE_NAMES.REMINDERS_SCAN,
      QUEUE_NAMES.REMINDERS_DELIVER,
      QUEUE_NAMES.NOTIFICATIONS_EMAIL,
    ]) {
      const worker = new Worker(name, (job) => this.process(name, job), {
        connection: this.root.connection,
        prefix: this.root.prefix,
        concurrency: [QUEUE_NAMES.EVENTS_DISPATCH, QUEUE_NAMES.REMINDERS_SCAN].includes(name)
          ? 1
          : this.concurrency,
      });
      worker.on('error', () =>
        this.logger.error('Notification worker infrastructure unavailable.'),
      );
      worker.on('failed', () =>
        this.logger.error('Notification job failed; durable status requires review.'),
      );
      this.workers.push(worker);
    }
    await this.queues
      .getQueue(QUEUE_NAMES.EVENTS_DISPATCH)
      .upsertJobScheduler(
        'notifications-dispatch-v1',
        { every: 5000 },
        { name: 'dispatch', data: { version: 1 } },
      );
    // A minute tick evaluates tenant-local daily occurrences. Semantic PG keys
    // make repeated ticks safe and avoid a server-timezone cron assumption.
    await this.queues
      .getQueue(QUEUE_NAMES.REMINDERS_SCAN)
      .upsertJobScheduler(
        'notifications-scan-v1',
        { every: 60000 },
        { name: 'scan', data: { version: 1 } },
      );
  }
  async process(queue, job) {
    if (queue === QUEUE_NAMES.REMINDERS_SCAN || queue === QUEUE_NAMES.EVENTS_DISPATCH) {
      if (
        job.name !== (queue === QUEUE_NAMES.REMINDERS_SCAN ? 'scan' : 'dispatch') ||
        !SCAN_JOB_SCHEMA.safeParse(job.data).success
      )
        throw new UnrecoverableError('INVALID_JOB_PAYLOAD');
      return queue === QUEUE_NAMES.REMINDERS_SCAN
        ? this.reminders.scan()
        : this.dispatcher.dispatch(EVENT_TYPES, (event) =>
            event.eventType === 'REMINDER_DELIVERY_REQUESTED' && event.payload?.channel === 'EMAIL'
              ? QUEUE_NAMES.NOTIFICATIONS_EMAIL
              : QUEUE_NAMES.REMINDERS_DELIVER,
          );
    }
    if (
      ![QUEUE_NAMES.REMINDERS_DELIVER, QUEUE_NAMES.NOTIFICATIONS_EMAIL].includes(queue) ||
      job.name !== 'event' ||
      !EVENT_JOB_SCHEMA.safeParse(job.data).success
    )
      throw new UnrecoverableError('INVALID_JOB_PAYLOAD');
    try {
      return await this.reminders.handleEvent(
        job.data,
        queue === QUEUE_NAMES.NOTIFICATIONS_EMAIL ? 'EMAIL' : 'IN_APP',
      );
    } catch {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
        try {
          await this.reminders.failEvent(job.data);
        } catch {
          this.logger.error(
            'Durable failure recording unavailable; the event lease remains recoverable.',
          );
        }
      }
      throw new Error('NOTIFICATION_WORK_RETRY');
    }
  }
  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
Inject(QueueFactory)(NotificationWorkers, undefined, 0);
Inject(BULLMQ_ROOT_OPTIONS)(NotificationWorkers, undefined, 1);
Inject(PendingEventDispatcher)(NotificationWorkers, undefined, 2);
Inject(RemindersService)(NotificationWorkers, undefined, 3);
Inject(ConfigService)(NotificationWorkers, undefined, 4);
Inject(PrismaService)(NotificationWorkers, undefined, 5);
