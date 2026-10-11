import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { NotificationWorkers } from './notification-workers.js';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue-names.js';
import { EVENT_TYPES } from '../domain/reminder.js';
describe('notification processor routing and bounded failures', () => {
  const data = { version: 1, organizationId: randomUUID(), eventId: randomUUID() };
  function fixture() {
    const reminders = { handleEvent: jest.fn(), failEvent: jest.fn(), scan: jest.fn() };
    const dispatcher = { dispatch: jest.fn() };
    const worker = new NotificationWorkers(
      {},
      {},
      dispatcher,
      reminders,
      { getOrThrow: () => ({ workerConcurrency: 2 }) },
      {},
    );
    return { reminders, dispatcher, worker };
  }
  it('rejects unrecognized names and snapshots without invoking delivery', async () => {
    const { worker, reminders } = fixture();
    await expect(
      worker.process(QUEUE_NAMES.REMINDERS_DELIVER, { name: 'unknown', data }),
    ).rejects.toThrow('INVALID_JOB_PAYLOAD');
    await expect(
      worker.process(QUEUE_NAMES.NOTIFICATIONS_EMAIL, {
        name: 'event',
        data: { ...data, balance: '100' },
      }),
    ).rejects.toThrow('INVALID_JOB_PAYLOAD');
    expect(reminders.handleEvent).not.toHaveBeenCalled();
  });
  it('routes valid identifiers to the correct channel and scans without source snapshots', async () => {
    const { worker, reminders } = fixture();
    await worker.process(QUEUE_NAMES.NOTIFICATIONS_EMAIL, { name: 'event', data });
    expect(reminders.handleEvent).toHaveBeenCalledWith(data, 'EMAIL');
    await worker.process(QUEUE_NAMES.REMINDERS_SCAN, { name: 'scan', data: { version: 1 } });
    expect(reminders.scan).toHaveBeenCalledTimes(1);
  });
  it('dispatches only owning-feature events using the canonical routing hints', async () => {
    const { worker, dispatcher } = fixture();
    await worker.process(QUEUE_NAMES.EVENTS_DISPATCH, { name: 'dispatch', data: { version: 1 } });
    const [types, route] = dispatcher.dispatch.mock.calls[0];
    expect(types).toEqual(EVENT_TYPES);
    expect(route({ eventType: 'REMINDER_DELIVERY_REQUESTED', payload: { channel: 'EMAIL' } })).toBe(
      QUEUE_NAMES.NOTIFICATIONS_EMAIL,
    );
    expect(route({ eventType: 'PAYMENT_RECORDED' })).toBe(QUEUE_NAMES.REMINDERS_DELIVER);
  });
  it('redacts transient errors and records durable failure only at exhaustion', async () => {
    const { worker, reminders } = fixture();
    reminders.handleEvent.mockRejectedValue(new Error('provider secret'));
    for (const attemptsMade of [0, 2])
      await expect(
        worker.process(QUEUE_NAMES.REMINDERS_DELIVER, {
          name: 'event',
          data,
          attemptsMade,
          opts: { attempts: 3 },
        }),
      ).rejects.toThrow('NOTIFICATION_WORK_RETRY');
    expect(reminders.failEvent).toHaveBeenCalledTimes(1);
    expect(reminders.failEvent).toHaveBeenCalledWith(data);
  });
});
