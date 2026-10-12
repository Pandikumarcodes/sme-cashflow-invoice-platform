import { expect, it } from 'vitest';
import {
  recordFormSchema,
  reversalSchema,
  parsePayment,
  parsePaymentList,
  defaultFilters,
  validFilters,
} from './contracts';
import { paymentFixture, reversedFixture, invoiceId } from './test-fixtures';
import { dashboardOrg as org } from '../dashboard/test-fixtures';
import { safeReturnTo } from '../../auth/return-to';
import { paymentKeys } from './queries';
it.each(['0', '-1', '1e2', '01', '0.001', '100.01', '1000000000000000'])(
  'rejects invalid USD amount %s',
  (amount) => {
    expect(
      recordFormSchema('USD', '100.00').safeParse({
        amount,
        method: 'CASH',
        paymentDate: '2026-10-01',
      }).success,
    ).toBe(false);
  },
);
it.each([
  ['USD', '0.01'],
  ['JPY', '1'],
  ['KWD', '0.001'],
  ['USD', '999999999999999.99'],
  ['USD', '1.0000'],
])('preserves exact positive %s amount %s', (currency, amount) => {
  expect(
    recordFormSchema(currency, '999999999999999.9999').parse({
      amount,
      method: 'OTHER',
      paymentDate: '2026-10-01',
    }).amount,
  ).toBe(amount);
});
it('validates real business dates without adding an unsupported future/order rule', () => {
  const schema = recordFormSchema('USD', '100');
  expect(schema.safeParse({ amount: '1', method: 'CASH', paymentDate: '2025-02-29' }).success).toBe(
    false,
  );
  expect(schema.safeParse({ amount: '1', method: 'CASH', paymentDate: '2096-02-29' }).success).toBe(
    true,
  );
  expect(reversalSchema.safeParse({ reason: ' ', reversalDate: '2026-01-01' }).success).toBe(false);
  expect(
    reversalSchema.safeParse({ reason: 'x'.repeat(501), reversalDate: '2026-01-01' }).success,
  ).toBe(false);
  expect(
    reversalSchema.safeParse({ reason: 'Correction', reversalDate: '1900-01-01', amount: '1' })
      .success,
  ).toBe(false);
  expect(
    schema.safeParse({
      amount: '1',
      method: 'CASH',
      paymentDate: '2026-01-01',
      reference: 'invented',
    }).success,
  ).toBe(false);
});
it('rejects tenant/currency/identity and partial-reversal contamination', () => {
  const p = paymentFixture();
  expect(parsePayment({ data: p }, org.id, 'USD').id).toBe(p.id);
  for (const value of [
    { ...p, organizationId: invoiceId },
    { ...p, currency: 'INR' },
    { ...p, invoiceId: p.id },
    { ...p, amount: '40.001' },
    { ...p, status: 'REVERSED' },
  ])
    expect(() => parsePayment({ data: value }, org.id, 'USD')).toThrow('unexpected payment');
  const reversed = reversedFixture();
  expect(parsePayment({ data: reversed }, org.id, 'USD').reversal?.amount).toBe('40.00');
  expect(() =>
    parsePayment(
      { data: { ...reversed, reversal: { ...reversed.reversal, amount: '20.00' } } },
      org.id,
      'USD',
    ),
  ).toThrow();
});
it('checks cursor metadata, duplicate rows and backend filters', () => {
  const p = paymentFixture();
  const page = { data: [p], meta: { limit: 25, hasMore: false, nextCursor: null } };
  expect(parsePaymentList(page, org.id, 'USD', defaultFilters).data).toHaveLength(1);
  expect(() =>
    parsePaymentList({ ...page, data: [p, p] }, org.id, 'USD', defaultFilters),
  ).toThrow();
  expect(() =>
    parsePaymentList(
      { ...page, meta: { ...page.meta, hasMore: true } },
      org.id,
      'USD',
      defaultFilters,
    ),
  ).toThrow();
  expect(() =>
    parsePaymentList(page, org.id, 'USD', { ...defaultFilters, status: 'REVERSED' }),
  ).toThrow();
  expect(validFilters({ ...defaultFilters, paymentDateFrom: '2026-02-30' })).toBe(false);
  expect(
    validFilters({ ...defaultFilters, paymentDateFrom: '2026-10-02', paymentDateTo: '2026-10-01' }),
  ).toBe(false);
  expect(
    validFilters({ ...defaultFilters, paymentDateFrom: '2000-01-01', paymentDateTo: '2026-10-01' }),
  ).toBe(false);
});
it('isolates account/tenant keys and allowlists only supported payment routes', () => {
  expect(paymentKeys.scope('account-a', org.id)).not.toEqual(
    paymentKeys.scope('account-b', org.id),
  );
  expect(paymentKeys.scope('account-a', org.id)).not.toEqual(
    paymentKeys.scope('account-a', invoiceId),
  );
  for (const suffix of ['', '/new', `/${paymentFixture().id}`]) {
    const route = `/organizations/${org.id}/payments${suffix}`;
    expect(safeReturnTo(route)).toBe(route);
  }
  expect(safeReturnTo(`/organizations/${org.id}/payments/${paymentFixture().id}/edit`)).toBe(
    '/session',
  );
});
