import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { businessDate, localDate } from '../../../common/time/business-date.js';
import { moneyString } from '../../../common/money/decimal.js';
import { InvoiceReminderReader } from '../../invoices/application/invoice-reminder-reader.js';
import { EmailProvider } from '../infrastructure/email-provider.js';
import {
  EVENT_JOB_SCHEMA,
  reminderType,
  reminderEligibility,
  reminderKey,
} from '../domain/reminder.js';

const correlation = z.string().min(1).max(128).nullable().optional();
const base = {
  version: z.literal(1),
  organizationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  requestId: correlation,
  correlationId: correlation,
};
const invoicePayload = z.object({ ...base, invoiceVersion: z.number().int().positive() }).strict();
const paymentPayload = z
  .object({
    ...base,
    paymentId: z.string().uuid(),
    reversalId: z.string().uuid().nullable(),
    invoiceVersion: z.number().int().positive(),
  })
  .strict();
const deliveryPayload = z
  .object({ ...base, deliveryId: z.string().uuid(), channel: z.enum(['IN_APP', 'EMAIL']) })
  .strict();

@Injectable()
export class RemindersService {
  constructor(persistence, authorization, reader, email, config, clock = () => new Date()) {
    this.persistence = persistence;
    this.authorization = authorization;
    this.reader = reader;
    this.email = email;
    this.policy = config.getOrThrow('notification');
    this.clock = clock;
  }
  async scan() {
    if (!this.policy.enabled) return 0;
    const client = await this.persistence.getClient();
    const now = this.clock();
    let organizationAfter,
      planned = 0;
    for (;;) {
      // Bounded global organization discovery is restricted to this system scan.
      const organizations = await client.organization.findMany({
        where: {
          status: 'ACTIVE',
          ...(organizationAfter ? { id: { gt: organizationAfter } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      if (!organizations.length) break;
      for (const org of organizations) {
        const today = localDate(org.timezone, now);
        const upcoming = businessDate(today);
        upcoming.setUTCDate(upcoming.getUTCDate() + this.policy.daysBeforeDue);
        let after = '00000000-0000-0000-0000-000000000000';
        for (;;) {
          const rows =
            await client.$queryRaw`SELECT id FROM invoices WHERE "organizationId" = ${org.id}::uuid AND status = 'ISSUED'
            AND "issueDate" <= ${today}::date AND id > ${after}::uuid
            AND ("dueDate" = ${upcoming}::date OR ("dueDate" < ${today}::date AND
              (${today}::date - "dueDate" - 1) % ${this.policy.overdueCadenceDays}::int = 0)) ORDER BY id LIMIT 100`;
          if (!rows.length) break;
          for (const row of rows)
            planned += await client.$transaction((tx) => this.plan(tx, org.id, row.id, now), {
              timeout: 15000,
            });
          after = rows.at(-1).id;
        }
      }
      organizationAfter = organizations.at(-1).id;
    }
    return planned;
  }
  async plan(tx, organizationId, invoiceId, now) {
    const facts = await this.reader.load(tx, organizationId, invoiceId, true);
    if (!facts) return 0;
    const date = localDate(facts.organization.timezone, now);
    const type = reminderType(facts.invoice, date, this.policy);
    if (!type) return 0;
    const effectiveDate = businessDate(date);
    const candidate = { effectiveDate, reminderType: type, channel: 'IN_APP' };
    if (reminderEligibility(facts, candidate, this.policy, now)) return 0;
    let created = 0;
    for (const channel of this.policy.emailProvider === 'disabled'
      ? ['IN_APP']
      : ['IN_APP', 'EMAIL']) {
      const where = { organizationId, invoiceId, reminderType: type, effectiveDate, channel };
      const inserted = await tx.reminderDelivery.createMany({
        data: [where],
        skipDuplicates: true,
      });
      if (!inserted.count) continue;
      const delivery = await tx.reminderDelivery.findFirst({ where });
      await tx.pendingEvent.create({
        data: {
          organizationId,
          eventType: 'REMINDER_DELIVERY_REQUESTED',
          eventVersion: 1,
          aggregateType: 'ReminderDelivery',
          aggregateId: delivery.id,
          payload: { version: 1, organizationId, invoiceId, deliveryId: delivery.id, channel },
        },
      });
      created++;
    }
    return created;
  }
  async notify(tx, organizationId, permission, data) {
    let after,
      count = 0;
    for (;;) {
      const members = await tx.membership.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, userId: true, role: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      if (!members.length) return count;
      const rows = members
        .filter((m) =>
          this.authorization.canAll(m.role, [permission, PERMISSIONS.NOTIFICATION_READ]),
        )
        .map((m) => ({ ...data, organizationId, recipientUserId: m.userId }));
      if (rows.length)
        count += (await tx.notification.createMany({ data: rows, skipDuplicates: true })).count;
      after = members.at(-1).id;
    }
  }
  async handleEvent(raw, expectedChannel) {
    const payload = EVENT_JOB_SCHEMA.parse(raw);
    const client = await this.persistence.getClient();
    const now = this.clock();
    const prepared = await client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM pending_events WHERE id = ${payload.eventId}::uuid AND "organizationId" = ${payload.organizationId}::uuid FOR UPDATE`;
        const where = { id: payload.eventId, organizationId: payload.organizationId };
        const event = await tx.pendingEvent.findFirst({ where });
        if (!event || ['PROCESSED', 'FAILED'].includes(event.status)) return null;
        const schema =
          event.eventType === 'INVOICE_ISSUED'
            ? invoicePayload
            : ['PAYMENT_RECORDED', 'PAYMENT_REVERSED'].includes(event.eventType)
              ? paymentPayload
              : event.eventType === 'REMINDER_DELIVERY_REQUESTED'
                ? deliveryPayload
                : null;
        const parsed = schema?.safeParse(event.payload);
        if (
          !parsed?.success ||
          event.eventVersion !== 1 ||
          parsed.data.organizationId !== payload.organizationId ||
          event.aggregateId !==
            (parsed.data.deliveryId ?? parsed.data.paymentId ?? parsed.data.invoiceId) ||
          event.aggregateType !==
            (parsed.data.deliveryId
              ? 'ReminderDelivery'
              : parsed.data.paymentId
                ? 'Payment'
                : 'Invoice')
        ) {
          await tx.pendingEvent.updateMany({
            where,
            data: { status: 'FAILED', lastErrorCode: 'INVALID_EVENT_PAYLOAD' },
          });
          return null;
        }
        const data = parsed.data;
        if (data.deliveryId) return this.prepareDelivery(tx, event, data, now, expectedChannel);
        if (data.paymentId) {
          const payment = await tx.payment.findFirst({
            where: {
              id: data.paymentId,
              organizationId: payload.organizationId,
              invoiceId: data.invoiceId,
            },
          });
          if (!payment) {
            await this.complete(tx, event, 'SOURCE_UNAVAILABLE');
            return null;
          }
          if (event.eventType === 'PAYMENT_RECORDED' && payment.status === 'RECORDED') {
            const facts = await this.reader.load(tx, payload.organizationId, data.invoiceId);
            if (facts?.organization.status === 'ACTIVE' && !facts.currencyMismatch)
              await this.notify(tx, payload.organizationId, PERMISSIONS.PAYMENT_READ, {
                type: 'PAYMENT_RECORDED',
                title: 'Payment recorded',
                body: `A payment was recorded for invoice ${facts.invoice.invoiceNumber}.`,
                relatedEntityType: 'Payment',
                relatedEntityId: payment.id,
                deduplicationKey: `payment-${payment.id}`,
              });
          }
        }
        await this.plan(tx, payload.organizationId, data.invoiceId, now);
        await this.complete(tx, event);
        return null;
      },
      { timeout: 15000 },
    );
    if (!prepared) return;
    let result;
    try {
      let timer;
      try {
        result = await Promise.race([
          this.email.send(prepared.message),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('EMAIL_TIMEOUT')), 10000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (!['SENT', 'SUPPRESSED', 'FAILED', 'RETRY'].includes(result?.outcome))
        result = { outcome: 'RETRY' };
    } catch {
      result = { outcome: 'RETRY' };
    }
    const retry = result.outcome === 'RETRY' && prepared.attemptCount < 3;
    await client.$transaction(async (tx) => {
      const where = {
        id: prepared.deliveryId,
        organizationId: payload.organizationId,
        status: 'PENDING',
      };
      const status = retry
        ? 'PENDING'
        : result.outcome === 'SENT'
          ? 'SENT'
          : result.outcome === 'SUPPRESSED'
            ? 'SUPPRESSED'
            : 'FAILED';
      await tx.reminderDelivery.updateMany({
        where,
        data: {
          status,
          sentAt: status === 'SENT' ? this.clock() : null,
          failedAt: status === 'FAILED' ? this.clock() : null,
          providerMessageId:
            status === 'SENT' && typeof result.providerMessageId === 'string'
              ? result.providerMessageId.slice(0, 200)
              : null,
          lastErrorCode:
            status === 'SENT'
              ? null
              : status === 'SUPPRESSED'
                ? 'EMAIL_DISABLED'
                : 'EMAIL_DELIVERY_FAILED',
        },
      });
      await tx.pendingEvent.updateMany({
        where: { id: payload.eventId, organizationId: payload.organizationId },
        data: {
          status: retry ? 'PENDING' : status === 'FAILED' ? 'FAILED' : 'PROCESSED',
          claimedAt: null,
          processedAt: retry || status === 'FAILED' ? null : this.clock(),
          lastErrorCode: retry
            ? 'EMAIL_RETRY'
            : status === 'FAILED'
              ? 'EMAIL_DELIVERY_FAILED'
              : null,
          availableAt: new Date(this.clock().getTime() + 1000 * 2 ** prepared.attemptCount),
        },
      });
      if (status === 'FAILED')
        await this.failureNotification(tx, payload.organizationId, prepared.deliveryId);
    });
    if (retry) throw new Error('EMAIL_RETRY');
  }
  async prepareDelivery(tx, event, data, now, expectedChannel) {
    if (data.channel !== expectedChannel) {
      await tx.pendingEvent.updateMany({
        where: { id: event.id, organizationId: event.organizationId },
        data: { status: 'FAILED', lastErrorCode: 'INVALID_JOB_CHANNEL' },
      });
      return null;
    }
    const facts = await this.reader.load(tx, event.organizationId, data.invoiceId, true);
    await tx.$queryRaw`SELECT id FROM reminder_deliveries WHERE id = ${data.deliveryId}::uuid AND "organizationId" = ${event.organizationId}::uuid FOR UPDATE`;
    const where = {
      id: data.deliveryId,
      organizationId: event.organizationId,
      invoiceId: data.invoiceId,
      channel: data.channel,
    };
    const delivery = await tx.reminderDelivery.findFirst({ where });
    if (!delivery || delivery.status !== 'PENDING') {
      await this.complete(tx, event);
      return null;
    }
    if (
      event.lastErrorCode === 'DELIVERY_IN_PROGRESS' &&
      event.claimedAt &&
      event.claimedAt.getTime() > now.getTime() - 60000
    )
      return null;
    const reason = reminderEligibility(facts, delivery, this.policy, now);
    if (reason) {
      await tx.reminderDelivery.updateMany({
        where,
        data: { status: 'SUPPRESSED', lastErrorCode: reason },
      });
      await this.complete(tx, event, reason);
      return null;
    }
    if (delivery.attemptCount >= 3) {
      await tx.reminderDelivery.updateMany({
        where,
        data: { status: 'FAILED', failedAt: now, lastErrorCode: 'ATTEMPTS_EXHAUSTED' },
      });
      await tx.pendingEvent.updateMany({
        where: { id: event.id, organizationId: event.organizationId },
        data: { status: 'FAILED', lastErrorCode: 'ATTEMPTS_EXHAUSTED' },
      });
      await this.failureNotification(tx, event.organizationId, delivery.id);
      return null;
    }
    const attemptCount = delivery.attemptCount + 1;
    if (delivery.channel === 'IN_APP') {
      const date = delivery.effectiveDate.toISOString().slice(0, 10);
      const count = await this.notify(tx, event.organizationId, PERMISSIONS.INVOICE_READ, {
        type: delivery.reminderType === 'DUE_SOON' ? 'INVOICE_DUE_SOON' : 'INVOICE_OVERDUE',
        title: delivery.reminderType === 'DUE_SOON' ? 'Invoice due soon' : 'Invoice overdue',
        body: `Invoice ${facts.invoice.invoiceNumber} has an outstanding balance of ${moneyString(facts.balance, facts.organization.baseCurrency)} ${facts.organization.baseCurrency}.`,
        relatedEntityType: 'Invoice',
        relatedEntityId: data.invoiceId,
        scheduledAt: now,
        deduplicationKey: reminderKey(data.invoiceId, delivery.reminderType, date, 'IN_APP'),
      });
      // One delivery is an organization occurrence; fan-out rows have individual
      // recipient dedupe keys. The optional single-notification link stays null.
      await tx.reminderDelivery.updateMany({
        where,
        data: {
          status: count ? 'SENT' : 'SUPPRESSED',
          attemptCount,
          sentAt: count ? now : null,
          lastErrorCode: count ? null : 'NO_ELIGIBLE_RECIPIENT',
        },
      });
      await this.complete(tx, event);
      return null;
    }
    await tx.reminderDelivery.updateMany({ where, data: { attemptCount } });
    await tx.pendingEvent.updateMany({
      where: { id: event.id, organizationId: event.organizationId },
      data: { status: 'PROCESSING', claimedAt: now, lastErrorCode: 'DELIVERY_IN_PROGRESS' },
    });
    return {
      deliveryId: delivery.id,
      attemptCount,
      message: {
        idempotencyKey: delivery.id,
        to: facts.customer.email,
        subject: delivery.reminderType === 'DUE_SOON' ? 'Invoice due soon' : 'Invoice overdue',
        body: `Invoice ${facts.invoice.invoiceNumber}: ${moneyString(facts.balance, facts.organization.baseCurrency)} ${facts.organization.baseCurrency} remains outstanding.`,
      },
    };
  }
  complete(tx, event, code = null) {
    return tx.pendingEvent.updateMany({
      where: { id: event.id, organizationId: event.organizationId },
      data: {
        status: 'PROCESSED',
        processedAt: this.clock(),
        claimedAt: null,
        lastErrorCode: code,
      },
    });
  }
  failureNotification(tx, organizationId, id) {
    return this.notify(tx, organizationId, PERMISSIONS.ORGANIZATION_UPDATE, {
      type: 'SYSTEM',
      title: 'Reminder delivery failed',
      body: 'A reminder delivery exhausted its attempts. Operational review is required.',
      relatedEntityType: 'ReminderDelivery',
      relatedEntityId: id,
      deduplicationKey: `delivery-failed-${id}`,
    });
  }
  async failEvent(raw) {
    const parsed = EVENT_JOB_SCHEMA.safeParse(raw);
    if (!parsed.success) return;
    const client = await this.persistence.getClient();
    await client.$transaction(async (tx) => {
      const where = {
        id: parsed.data.eventId,
        organizationId: parsed.data.organizationId,
        status: { in: ['PENDING', 'PROCESSING'] },
      };
      const event = await tx.pendingEvent.findFirst({ where });
      if (!event) return;
      await tx.pendingEvent.updateMany({
        where,
        data: { status: 'FAILED', lastErrorCode: 'WORKER_ATTEMPTS_EXHAUSTED' },
      });
      if (event.aggregateType === 'ReminderDelivery') {
        const updated = await tx.reminderDelivery.updateMany({
          where: { id: event.aggregateId, organizationId: event.organizationId, status: 'PENDING' },
          data: {
            status: 'FAILED',
            failedAt: this.clock(),
            lastErrorCode: 'WORKER_ATTEMPTS_EXHAUSTED',
          },
        });
        if (updated.count)
          await this.failureNotification(tx, event.organizationId, event.aggregateId);
      }
    });
  }
}
Inject(PrismaService)(RemindersService, undefined, 0);
Inject(AuthorizationService)(RemindersService, undefined, 1);
Inject(InvoiceReminderReader)(RemindersService, undefined, 2);
Inject(EmailProvider)(RemindersService, undefined, 3);
Inject(ConfigService)(RemindersService, undefined, 4);
