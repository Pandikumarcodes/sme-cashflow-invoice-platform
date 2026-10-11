import { z } from 'zod';
import { businessDate, localDate } from '../../../common/time/business-date.js';
import { Decimal } from '../../../common/money/decimal.js';

export const EVENT_TYPES = [
  'INVOICE_ISSUED',
  'PAYMENT_RECORDED',
  'PAYMENT_REVERSED',
  'REMINDER_DELIVERY_REQUESTED',
];
export const EVENT_JOB_SCHEMA = z
  .object({ version: z.literal(1), organizationId: z.string().uuid(), eventId: z.string().uuid() })
  .strict();
export const SCAN_JOB_SCHEMA = z.object({ version: z.literal(1) }).strict();
export function reminderType(invoice, date, policy) {
  const days =
    (businessDate(invoice.dueDate.toISOString().slice(0, 10)) - businessDate(date)) / 86400000;
  if (days === policy.daysBeforeDue) return 'DUE_SOON';
  if (days < 0 && (-days - 1) % policy.overdueCadenceDays === 0) return 'OVERDUE';
  return null;
}
export function reminderEligibility(facts, delivery, policy, now) {
  if (!policy.enabled) return 'REMINDERS_DISABLED';
  if (!facts || facts.organization.status !== 'ACTIVE') return 'SOURCE_UNAVAILABLE';
  if (facts.invoice.status !== 'ISSUED') return 'INVOICE_NOT_ISSUED';
  if (facts.currencyMismatch || new Decimal(facts.balance).isNegative())
    return 'SETTLEMENT_INVALID';
  if (new Decimal(facts.balance).isZero()) return 'INVOICE_PAID';
  if (facts.customer.status !== 'ACTIVE') return 'CUSTOMER_ARCHIVED';
  const today = localDate(facts.organization.timezone, now);
  if (facts.invoice.issueDate.toISOString().slice(0, 10) > today) return 'INVOICE_NOT_EFFECTIVE';
  if (
    today !== delivery.effectiveDate.toISOString().slice(0, 10) ||
    reminderType(facts.invoice, today, policy) !== delivery.reminderType
  )
    return 'DATE_INELIGIBLE';
  if (delivery.channel === 'EMAIL' && policy.emailProvider === 'disabled') return 'EMAIL_DISABLED';
  if (delivery.channel === 'EMAIL' && !facts.customer.email) return 'CUSTOMER_EMAIL_MISSING';
  return null;
}
export function reminderKey(invoiceId, type, date, channel) {
  return `reminder-${invoiceId}-${type}-${date}-${channel}`;
}
