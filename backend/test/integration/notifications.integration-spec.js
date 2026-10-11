import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PendingEventDispatcher } from '../../src/infrastructure/queues/pending-event-dispatcher.js';
import { QUEUE_NAMES } from '../../src/infrastructure/queues/queue-names.js';
import { EVENT_TYPES } from '../../src/modules/notifications/domain/reminder.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';
import {
  notificationFixture,
  reminderEvents,
  deliverReminders,
  eventJob,
  REMINDER_NOW,
} from '../helpers/notification-fixture.js';

jest.setTimeout(30000);
describe('notifications and reminders PostgreSQL durability', () => {
  const prisma = createTestPrismaClient();
  let a, b;
  beforeEach(async () => {
    await clearDatabase(prisma);
    a = await notificationFixture(prisma, 'notify-a');
    b = await notificationFixture(prisma, 'notify-b');
  });
  afterAll(async () => prisma.$disconnect());
  const record = (f, amount = '1000') =>
    f.payments.record(
      f.tenant,
      f.invoice.id,
      { amount, paymentDate: '2026-01-31', method: 'BANK_TRANSFER' },
      randomUUID(),
    );
  const own = (model, f = a) => prisma[model].findMany({ where: { organizationId: f.org.id } });
  it('creates atomic delivery/outbox occurrences and deduplicates concurrent scans and worker retries', async () => {
    const auditCount = await prisma.auditLog.count();
    const before = await prisma.invoice.findMany({ orderBy: { id: 'asc' } });
    await Promise.all([a.reminders.scan(), a.reminders.scan()]);
    expect(await own('reminderDelivery')).toHaveLength(1);
    expect(await reminderEvents(prisma, a)).toHaveLength(1);
    const event = (await reminderEvents(prisma, a))[0];
    expect(event.payload).toEqual({
      version: 1,
      organizationId: a.org.id,
      invoiceId: a.invoice.id,
      deliveryId: event.aggregateId,
      channel: 'IN_APP',
    });
    await Promise.all([
      a.reminders.handleEvent(eventJob(event), 'IN_APP'),
      a.reminders.handleEvent(eventJob(event), 'IN_APP'),
    ]);
    expect(await own('notification')).toHaveLength(1);
    expect((await own('reminderDelivery'))[0]).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(await prisma.invoice.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.auditLog.count()).toBe(auditCount);
    await expect(
      prisma.$transaction(async (tx) => {
        await a.reminders.plan(tx, a.org.id, a.invoice.id, new Date('2026-02-07T20:00:00Z'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await own('reminderDelivery')).toHaveLength(1);
  });
  it('scopes inbox cursors and mutations to tenant plus recipient and preserves retry timestamps', async () => {
    await a.reminders.scan();
    await deliverReminders(prisma, a);
    await deliverReminders(prisma, b);
    const row = (await own('notification'))[0];
    await prisma.notification.create({
      data: {
        organizationId: a.org.id,
        recipientUserId: b.user.id,
        type: 'SYSTEM',
        title: 'Other recipient',
        body: 'Private',
      },
    });
    expect((await a.notifications.list(a.tenant)).data).toHaveLength(1);
    await expect(
      a.notifications.archive(a.tenant, (await own('notification', b))[0].id),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(a.notifications.markRead({ ...a.tenant }, row.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    const first = await a.notifications.markRead(a.tenant, row.id);
    expect(await a.notifications.markRead(a.tenant, row.id)).toEqual(first);
    const archived = await a.notifications.archive(a.tenant, row.id);
    expect(await a.notifications.archive(a.tenant, row.id)).toEqual(archived);
    expect(await a.notifications.markRead(a.tenant, row.id)).toEqual(archived);
    expect((await a.notifications.list(a.tenant)).data).toEqual([]);
    expect((await a.notifications.list(a.tenant, { status: 'ARCHIVED' })).data).toHaveLength(1);
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(a.notifications.list(a.tenant)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
  it('uses current receipts despite stale caches and suppresses paid work; reversal reopens eligibility', async () => {
    await a.reminders.scan();
    const payment = await record(a);
    await prisma.invoice.update({
      where: { id: a.invoice.id },
      data: { amountPaid: '0', balanceDue: '1000' },
    });
    await deliverReminders(prisma, a);
    expect((await own('reminderDelivery'))[0]).toMatchObject({
      status: 'SUPPRESSED',
      lastErrorCode: 'INVOICE_PAID',
    });
    expect(await own('notification')).toEqual([]);
    await prisma.invoice.update({
      where: { id: a.invoice.id },
      data: {
        amountPaid: '1000',
        balanceDue: '0',
      },
    });
    await a.payments.reverse(
      a.tenant,
      payment.data.id,
      { reason: 'Wrong', reversalDate: '2026-02-01' },
      randomUUID(),
    );
    await prisma.$transaction((tx) =>
      a.reminders.plan(tx, a.org.id, a.invoice.id, new Date('2026-02-07T20:00:00Z')),
    );
    const reopened = (await own('reminderDelivery')).find((row) =>
      row.effectiveDate.toISOString().startsWith('2026-02-08'),
    );
    expect(reopened).toMatchObject({ status: 'PENDING' });
  });
  it('suppresses cancelled/void/customer-archived work and honors local dates, due-today and disabled policy', async () => {
    await a.reminders.scan();
    await a.invoices.endLifecycle(a.tenant, a.invoice.id, 'CANCELLED', 'Wrong');
    await b.invoices.endLifecycle(b.tenant, b.invoice.id, 'VOID', 'Wrong');
    await deliverReminders(prisma, a);
    await deliverReminders(prisma, b);
    expect((await own('reminderDelivery'))[0].lastErrorCode).toBe('INVOICE_NOT_ISSUED');
    expect((await own('reminderDelivery', b))[0].status).toBe('SUPPRESSED');
    const c = await notificationFixture(prisma, 'notify-west', { timezone: 'America/Los_Angeles' });
    await c.reminders.scan();
    expect(await own('reminderDelivery', c)).toEqual([]);
    const d = await notificationFixture(prisma, 'notify-archived');
    await prisma.customer.update({ where: { id: d.customer.id }, data: { status: 'ARCHIVED' } });
    await d.reminders.scan();
    expect(await own('reminderDelivery', d)).toEqual([]);
    d.reminders.policy = { ...d.reminders.policy, enabled: false };
    expect(await d.reminders.scan()).toBe(0);
  });
  it('consumes supported source events once and filters payment recipients by current permissions', async () => {
    await prisma.membership.create({
      data: { organizationId: a.org.id, userId: b.user.id, role: 'MEMBER' },
    });
    await record(a, '0.10');
    const event = await prisma.pendingEvent.findFirst({
      where: { organizationId: a.org.id, eventType: 'PAYMENT_RECORDED' },
    });
    await a.reminders.handleEvent(eventJob(event), 'IN_APP');
    await a.reminders.handleEvent(eventJob(event), 'IN_APP');
    const notices = (await own('notification')).filter((row) => row.type === 'PAYMENT_RECORDED');
    expect(notices).toHaveLength(1);
    expect(notices[0].recipientUserId).toBe(a.user.id);
    expect((await prisma.pendingEvent.findUnique({ where: { id: event.id } })).status).toBe(
      'PROCESSED',
    );
    await deliverReminders(prisma, a);
    expect(
      (await own('notification')).filter((row) => row.type === 'INVOICE_OVERDUE'),
    ).toHaveLength(2);
  });
  it('validates queue/event identity and never reads a foreign source by UUID alone', async () => {
    await a.reminders.scan();
    const event = (await reminderEvents(prisma, a))[0];
    await a.reminders.handleEvent({ ...eventJob(event), organizationId: b.org.id }, 'IN_APP');
    expect(await own('notification')).toEqual([]);
    await prisma.pendingEvent.update({
      where: { id: event.id },
      data: { payload: { ...event.payload, invoiceId: b.invoice.id } },
    });
    await a.reminders.handleEvent(eventJob(event), 'IN_APP');
    expect(await own('notification')).toEqual([]);
    expect(await own('notification', b)).toEqual([]);
    await expect(
      a.reminders.handleEvent({ ...eventJob(event), balance: '100' }, 'IN_APP'),
    ).rejects.toThrow();
  });
  it('retries email with one durable provider key, persists success and prevents duplicate sends', async () => {
    const calls = [];
    const f = await notificationFixture(prisma, 'notify-email', {
      policy: { emailProvider: 'capture' },
      email: {
        send: async (message) => {
          calls.push(message);
          return calls.length < 3
            ? { outcome: 'RETRY' }
            : { outcome: 'SENT', providerMessageId: 'safe-result' };
        },
      },
    });
    await f.reminders.scan();
    const event = (await reminderEvents(prisma, f)).find((row) => row.payload.channel === 'EMAIL');
    await expect(f.reminders.handleEvent(eventJob(event), 'EMAIL')).rejects.toThrow('EMAIL_RETRY');
    await expect(f.reminders.handleEvent(eventJob(event), 'EMAIL')).rejects.toThrow('EMAIL_RETRY');
    await f.reminders.handleEvent(eventJob(event), 'EMAIL');
    await f.reminders.handleEvent(eventJob(event), 'EMAIL');
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((row) => row.idempotencyKey)).size).toBe(1);
    expect((await own('reminderDelivery', f)).find((row) => row.channel === 'EMAIL')).toMatchObject(
      { status: 'SENT', attemptCount: 3, providerMessageId: 'safe-result' },
    );
  });
  it('retains exhausted delivery/event failures and deduplicates safe admin alerts', async () => {
    const f = await notificationFixture(prisma, 'notify-failure', {
      policy: { emailProvider: 'capture' },
      email: {
        send: async () => {
          throw new Error('private provider secret');
        },
      },
    });
    await f.reminders.scan();
    const event = (await reminderEvents(prisma, f)).find((row) => row.payload.channel === 'EMAIL');
    for (let i = 0; i < 2; i++)
      await expect(f.reminders.handleEvent(eventJob(event), 'EMAIL')).rejects.toThrow(
        'EMAIL_RETRY',
      );
    await f.reminders.handleEvent(eventJob(event), 'EMAIL');
    await f.reminders.handleEvent(eventJob(event), 'EMAIL');
    expect((await own('reminderDelivery', f)).find((row) => row.channel === 'EMAIL')).toMatchObject(
      { status: 'FAILED', attemptCount: 3, lastErrorCode: 'EMAIL_DELIVERY_FAILED' },
    );
    expect((await own('notification', f)).filter((row) => row.type === 'SYSTEM')).toHaveLength(1);
    expect(JSON.stringify(await own('reminderDelivery', f))).not.toContain(
      'private provider secret',
    );
  });
  it('defers broker outages, recovers expired leases, and dispatches committed ID-only work', async () => {
    await prisma.pendingEvent.updateMany({ data: { availableAt: REMINDER_NOW } });
    const jobs = [];
    let unavailable = true;
    const dispatcher = new PendingEventDispatcher(a.provider, {
      getQueue: () => ({
        add: async (...args) => {
          if (unavailable) throw new Error('offline');
          jobs.push(args);
        },
      }),
    });
    await dispatcher.dispatch(EVENT_TYPES, () => QUEUE_NAMES.REMINDERS_DELIVER, REMINDER_NOW);
    expect((await own('pendingEvent'))[0]).toMatchObject({
      status: 'PENDING',
      lastErrorCode: 'QUEUE_UNAVAILABLE',
    });
    unavailable = false;
    await dispatcher.dispatch(
      EVENT_TYPES,
      () => QUEUE_NAMES.REMINDERS_DELIVER,
      new Date(REMINDER_NOW.getTime() + 31000),
    );
    await dispatcher.dispatch(
      EVENT_TYPES,
      () => QUEUE_NAMES.REMINDERS_DELIVER,
      new Date(REMINDER_NOW.getTime() + 92000),
    );
    expect(jobs).toHaveLength(4);
    expect(jobs[0][1]).toEqual({
      version: 1,
      organizationId: jobs[0][1].organizationId,
      eventId: jobs[0][1].eventId,
    });
    expect(jobs[0][2].jobId).not.toBe(jobs[2][2].jobId);
  });
  it('enforces the composite notification FK and retains tenant scope on notification deletion', async () => {
    await a.reminders.scan();
    await deliverReminders(prisma, a);
    await deliverReminders(prisma, b);
    const delivery = (await own('reminderDelivery'))[0],
      foreign = (await own('notification', b))[0],
      ownNotification = (await own('notification'))[0];
    await expect(
      prisma.reminderDelivery.update({
        where: { id: delivery.id },
        data: { notificationId: foreign.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await prisma.reminderDelivery.update({
      where: { id: delivery.id },
      data: { notificationId: ownNotification.id },
    });
    await prisma.notification.delete({ where: { id: ownNotification.id } });
    expect(await prisma.reminderDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      organizationId: a.org.id,
      notificationId: null,
    });
  });
});
