import { reminderType, reminderEligibility, reminderKey, EVENT_JOB_SCHEMA } from './reminder.js';
const policy = { enabled: true, daysBeforeDue: 3, overdueCadenceDays: 7, emailProvider: 'capture' };
const invoice = {
  status: 'ISSUED',
  issueDate: new Date('2026-01-01'),
  dueDate: new Date('2026-01-31'),
};
const facts = {
  invoice,
  organization: { status: 'ACTIVE', timezone: 'Asia/Kolkata' },
  customer: { status: 'ACTIVE', email: 'customer@example.com' },
  balance: '0.30',
};
const delivery = {
  channel: 'IN_APP',
  effectiveDate: new Date('2026-02-01'),
  reminderType: 'OVERDUE',
};
const now = new Date('2026-01-31T20:00:00Z');
describe('reminder eligibility and semantic identity', () => {
  it.each([
    ['2026-01-28', 'DUE_SOON'],
    ['2026-01-29', null],
    ['2026-01-31', null],
    ['2026-02-01', 'OVERDUE'],
    ['2026-02-02', null],
    ['2026-02-08', 'OVERDUE'],
  ])('evaluates due/overdue cadence on %s', (date, type) =>
    expect(reminderType(invoice, date, policy)).toBe(type),
  );
  it('uses tenant today rather than server UTC and exact positive Decimal balances', () => {
    expect(reminderEligibility(facts, delivery, policy, now)).toBeNull();
    expect(
      reminderEligibility(
        { ...facts, organization: { ...facts.organization, timezone: 'America/Los_Angeles' } },
        delivery,
        policy,
        now,
      ),
    ).toBe('DATE_INELIGIBLE');
  });
  it.each(['DRAFT', 'CANCELLED', 'VOID'])('suppresses %s invoices', (status) =>
    expect(
      reminderEligibility({ ...facts, invoice: { ...invoice, status } }, delivery, policy, now),
    ).toBe('INVOICE_NOT_ISSUED'),
  );
  it.each([
    [{ ...facts, balance: '0' }, 'INVOICE_PAID'],
    [{ ...facts, balance: '-0.01' }, 'SETTLEMENT_INVALID'],
    [{ ...facts, currencyMismatch: true }, 'SETTLEMENT_INVALID'],
    [{ ...facts, customer: { status: 'ARCHIVED' } }, 'CUSTOMER_ARCHIVED'],
    [null, 'SOURCE_UNAVAILABLE'],
    [
      { ...facts, invoice: { ...invoice, issueDate: new Date('2026-02-02') } },
      'INVOICE_NOT_EFFECTIVE',
    ],
  ])('fails closed on ineligible facts', (input, code) =>
    expect(reminderEligibility(input, delivery, policy, now)).toBe(code),
  );
  it('suppresses disabled/stale/missing-contact work', () => {
    expect(reminderEligibility(facts, delivery, { ...policy, enabled: false }, now)).toBe(
      'REMINDERS_DISABLED',
    );
    expect(
      reminderEligibility(
        facts,
        { ...delivery, effectiveDate: new Date('2026-01-25') },
        policy,
        now,
      ),
    ).toBe('DATE_INELIGIBLE');
    expect(
      reminderEligibility(
        facts,
        { ...delivery, channel: 'EMAIL' },
        { ...policy, emailProvider: 'disabled' },
        now,
      ),
    ).toBe('EMAIL_DISABLED');
    expect(
      reminderEligibility(
        { ...facts, customer: { status: 'ACTIVE' } },
        { ...delivery, channel: 'EMAIL' },
        policy,
        now,
      ),
    ).toBe('CUSTOMER_EMAIL_MISSING');
  });
  it('distinguishes retry identity from a new occurrence and rejects financial snapshots in jobs', () => {
    expect(reminderKey('id', 'OVERDUE', '2026-02-01', 'IN_APP')).not.toBe(
      reminderKey('id', 'OVERDUE', '2026-02-08', 'IN_APP'),
    );
    expect(EVENT_JOB_SCHEMA.safeParse({ version: 2 }).success).toBe(false);
    expect(
      EVENT_JOB_SCHEMA.safeParse({
        version: 1,
        organizationId: 'bad',
        eventId: 'bad',
        balance: '100',
      }).success,
    ).toBe(false);
  });
});
