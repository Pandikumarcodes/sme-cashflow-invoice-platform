import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { QUEUE_NAMES } from './queue-names.js';
import { BULLMQ_ROOT_OPTIONS } from './queue-options.js';

const canonicalQueueNames = new Set(Object.values(QUEUE_NAMES));

@Injectable()
export class QueueFactory {
  queues = new Map();

  constructor(rootOptions) {
    this.rootOptions = rootOptions;
  }

  getQueue(name) {
    if (!canonicalQueueNames.has(name)) {
      throw new Error('Queue name must use the canonical queue-name catalog');
    }
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, this.rootOptions));
    }
    return this.queues.get(name);
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}
Inject(BULLMQ_ROOT_OPTIONS)(QueueFactory, undefined, 0);
