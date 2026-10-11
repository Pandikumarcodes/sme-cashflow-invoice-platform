import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { QueueFactory } from './queue.factory.js';

@Injectable()
export class PendingEventDispatcher {
  constructor(persistence, queues) {
    this.persistence = persistence;
    this.queues = queues;
  }
  // Global operational discovery is intentional. Consumers still verify the
  // event's tenant and every referenced source. Unsupported events stay untouched.
  async dispatch(eventTypes, route, now = new Date()) {
    const client = await this.persistence.getClient();
    const events = await client.$transaction(async (tx) => {
      const rows =
        await tx.$queryRaw`SELECT id, "organizationId", "eventType", payload, "attemptCount"
        FROM pending_events WHERE "organizationId" IS NOT NULL
        AND "eventType" IN (${Prisma.join(eventTypes)})
        AND ((status = 'PENDING' AND "availableAt" <= ${now}) OR
          (status = 'PROCESSING' AND "claimedAt" < ${new Date(now.getTime() - 60000)}))
        ORDER BY "availableAt", id LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const row of rows)
        await tx.pendingEvent.updateMany({
          where: { id: row.id, organizationId: row.organizationId },
          data: {
            status: 'PROCESSING',
            claimedAt: now,
            attemptCount: { increment: 1 },
            lastErrorCode: null,
          },
        });
      return rows;
    });
    let published = 0;
    for (const event of events) {
      try {
        const queue = this.queues.getQueue(route(event));
        const data = { version: 1, organizationId: event.organizationId, eventId: event.id };
        // A recovered lease has a new durable generation; consumer dedupe is in PG.
        let timer;
        try {
          await Promise.race([
            queue.add('event', data, {
              jobId: `event-${event.id}-${event.attemptCount + 1}`,
              backoff: { type: 'exponential', delay: 1000, jitter: 0.2 },
            }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('DISPATCH_UNAVAILABLE')), 2000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        published++;
      } catch {
        // Transport outage is deferred durable work, not a failed financial write.
        await client.pendingEvent.updateMany({
          where: {
            id: event.id,
            organizationId: event.organizationId,
            status: 'PROCESSING',
            claimedAt: now,
          },
          data: {
            status: 'PENDING',
            claimedAt: null,
            availableAt: new Date(now.getTime() + 30000),
            lastErrorCode: 'QUEUE_UNAVAILABLE',
          },
        });
      }
    }
    return published;
  }
}
Inject(PrismaService)(PendingEventDispatcher, undefined, 0);
Inject(QueueFactory)(PendingEventDispatcher, undefined, 1);
