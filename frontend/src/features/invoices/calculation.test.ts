import { expect, it } from 'vitest';
import { previewInvoice, formatInvoiceMoney } from './calculation';
import { invoiceFormSchema } from './contracts';
const input = {
  customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  discount: { type: 'NONE' as const, value: '0' },
  taxRate: '0',
  items: [{ description: 'Service', quantity: '3', unitPrice: '33.335', sortOrder: 0 }],
};
it('matches backend half-up line rounding before discount and tax', () => {
  expect(
    previewInvoice(
      { ...input, discount: { type: 'PERCENTAGE', value: '10' }, taxRate: '18' },
      'INR',
    ),
  ).toEqual({
    lines: ['100.01'],
    subtotal: '100.01',
    discountTotal: '10.00',
    taxableTotal: '90.01',
    taxTotal: '16.20',
    total: '106.21',
  });
});
it('rounds each line rather than raw invoice multiplication', () => {
  expect(
    previewInvoice(
      {
        ...input,
        items: [0, 1].map((sortOrder) => ({
          description: 'Small item',
          quantity: '1',
          unitPrice: '0.005',
          sortOrder,
        })),
      },
      'USD',
    ).total,
  ).toBe('0.02');
});
it.each([
  ['JPY', '100'],
  ['KWD', '100.005'],
  ['USD', '100.01'],
])('uses %s currency scale', (currency, expected) => {
  expect(previewInvoice(input, currency).total).toBe(expected);
});
it('keeps large amounts exact in previews and formatted output', () => {
  const result = previewInvoice(
    { ...input, items: [{ ...input.items[0]!, quantity: '1', unitPrice: '999999999999999.99' }] },
    'USD',
  );
  expect(result.total).toBe('999999999999999.99');
  expect(formatInvoiceMoney(result.total, 'USD')).toBe('$999,999,999,999,999.99');
});
it.each(['0', '0.0000001', '01', '1e3', '-1'])('rejects invalid quantity %s', (quantity) => {
  expect(
    invoiceFormSchema('USD').safeParse({ ...input, items: [{ ...input.items[0]!, quantity }] })
      .success,
  ).toBe(false);
});
it.each(['1.00001', '01', '1e2', '-1'])('rejects invalid price %s', (unitPrice) => {
  expect(
    invoiceFormSchema('USD').safeParse({ ...input, items: [{ ...input.items[0]!, unitPrice }] })
      .success,
  ).toBe(false);
});
it('rejects fixed discount extra minor units, oversized values and discount greater than subtotal', () => {
  expect(() =>
    previewInvoice({ ...input, discount: { type: 'FIXED', value: '0.001' } }, 'USD'),
  ).toThrow();
  expect(() =>
    previewInvoice({ ...input, discount: { type: 'FIXED', value: '99999999999999' } }, 'USD'),
  ).toThrow();
  expect(() =>
    previewInvoice({ ...input, discount: { type: 'FIXED', value: '101' } }, 'USD'),
  ).toThrow();
});
it('rejects overflow, duplicate sort order, zero quantity, invalid rates and nonzero NONE discount', () => {
  expect(() =>
    previewInvoice(
      {
        ...input,
        items: [{ ...input.items[0]!, quantity: '9999999999999', unitPrice: '999999999999999.99' }],
      },
      'USD',
    ),
  ).toThrow();
  expect(() =>
    previewInvoice({ ...input, items: [input.items[0]!, input.items[0]!] }, 'USD'),
  ).toThrow();
  expect(() => previewInvoice({ ...input, taxRate: '100.000001' }, 'USD')).toThrow();
  expect(() =>
    previewInvoice({ ...input, discount: { type: 'NONE', value: '1' } }, 'USD'),
  ).toThrow();
});
it('allows zero-total drafts but rejects empty items, unsupported fields and impossible or reversed dates', () => {
  expect(
    invoiceFormSchema('USD').safeParse({
      ...input,
      items: [{ ...input.items[0]!, unitPrice: '0' }],
    }).success,
  ).toBe(true);
  for (const patch of [
    { items: [] },
    { currency: 'USD' },
    { notes: 'unsupported' },
    { issueDate: '2026-02-30' },
    { dueDate: '2026-09-30' },
  ])
    expect(invoiceFormSchema('USD').safeParse({ ...input, ...patch }).success).toBe(false);
});
