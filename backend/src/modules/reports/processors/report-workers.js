import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, UnrecoverableError } from 'bullmq';
import { QueueFactory } from '../../../infrastructure/queues/queue.factory.js';
import { PendingEventDispatcher } from '../../../infrastructure/queues/pending-event-dispatcher.js';
import { BULLMQ_ROOT_OPTIONS } from '../../../infrastructure/queues/queue-options.js';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue-names.js';
import { ReportGenerationService } from '../application/report-generation.service.js';
import { JOB_SCHEMA, REPORT_EVENT } from '../domain/report.js';

@Injectable()
export class ReportWorkers {
  logger = new Logger(ReportWorkers.name);
  constructor(queues, root, dispatcher, generation, config) {
    Object.assign(this, { queues, root, dispatcher, generation });
    this.concurrency = config?.get('WORKER_CONCURRENCY') ?? 2;
  }
  async process(job) {
    if (job.name === 'dispatch' && job.data?.version === 1 && Object.keys(job.data).length === 1)
      return this.dispatcher.dispatch([REPORT_EVENT], () => QUEUE_NAMES.REPORTS_GENERATE);
    if (job.name !== 'event' || !JOB_SCHEMA.safeParse(job.data).success)
      throw new UnrecoverableError('INVALID_REPORT_JOB');
    try {
      await this.generation.handleEvent(job.data);
    } catch {
      throw new Error('REPORT_WORK_UNAVAILABLE');
    }
  }
  async onModuleInit() {
    await this.queues.getQueue(QUEUE_NAMES.REPORTS_GENERATE).waitUntilReady();
    this.worker = new Worker(QUEUE_NAMES.REPORTS_GENERATE, (job) => this.process(job), {
      connection: this.root.connection,
      prefix: this.root.prefix,
      concurrency: this.concurrency,
    });
    this.worker.on('error', () => this.logger.error('Report worker infrastructure unavailable.'));
    this.worker.on('failed', () =>
      this.logger.error('Report job failed; inspect durable export status.'),
    );
    await this.queues
      .getQueue(QUEUE_NAMES.REPORTS_GENERATE)
      .upsertJobScheduler(
        'reports-dispatch-v1',
        { every: 5000 },
        { name: 'dispatch', data: { version: 1 } },
      );
  }
  async onModuleDestroy() {
    await this.worker?.close();
  }
}
Inject(QueueFactory)(ReportWorkers, undefined, 0);
Inject(BULLMQ_ROOT_OPTIONS)(ReportWorkers, undefined, 1);
Inject(PendingEventDispatcher)(ReportWorkers, undefined, 2);
Inject(ReportGenerationService)(ReportWorkers, undefined, 3);
Inject(ConfigService)(ReportWorkers, undefined, 4);
