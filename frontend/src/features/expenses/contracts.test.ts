import { expect, it } from 'vitest';
import {
  categoryInputSchema,
  categoryFormSchema,
  expenseFormSchema,
  expensePayload,
  parseCategory,
  parseExpense,
  parsePage,
  validateExpense,
  validFilters,
  defaultFilters,
  voidSchema,
} from './contracts';
import { categoryFixture, expenseFixture, voidedFixture, expenseId } from './test-fixtures';
import { dashboardOrg as org } from '../dashboard/test-fixtures';
import { safeReturnTo } from '../../auth/return-to';
import { expenseKeys, categoryKeys } from './queries';
const input = (amount: string) => ({
  categoryId: categoryFixture().id,
  amount,
  expenseDate: '2026-10-01',
  description: 'Electricity',
  vendorPayee: '',
  reference: '',
  notes: '',
});
it.each(['', 'abc', '0', '-1', '01', '1e2', '0.001', '1000000000000000', '1.00001'])(
  'rejects invalid expense amount %s safely',
  (amount) => {
    expect(expenseFormSchema('USD').safeParse(input(amount)).success).toBe(false);
  },
);
it.each([
  ['USD', '999999999999999.99'],
  ['JPY', '1'],
  ['KWD', '0.001'],
  ['USD', '1.0000'],
])('preserves exact %s amount %s', (currency, amount) => {
  expect(expenseFormSchema(currency).parse(input(amount)).amount).toBe(amount);
});
it('matches normalized category-name uniqueness bounds, including lowercase expansion', () => {
  expect(categoryInputSchema.safeParse({ name: '  Office   supplies  ' }).success).toBe(true);
  expect(categoryInputSchema.safeParse({ name: ' '.repeat(200) + 'A' }).success).toBe(true);
  for (const name of ['', ' ', 'a'.repeat(101), 'İ'.repeat(100)])
    expect(categoryInputSchema.safeParse({ name }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ name: 'Valid', description: null }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ name: 'Valid', systemKey: 'UTILITIES' }).success).toBe(
    false,
  );
  expect(
    categoryFormSchema(categoryFixture()).safeParse({ name: 'Utilities', description: '' }).success,
  ).toBe(false);
});
it('serializes only supported nullable clears and enforces all text bounds', () => {
  const values = expenseFormSchema('USD').parse(input('40.00'));
  expect(expensePayload(values)).toEqual({
    ...values,
    vendorPayee: null,
    reference: null,
    notes: null,
  });
  for (const [field, length] of [
    ['vendorPayee', 201],
    ['description', 501],
    ['reference', 151],
    ['notes', 1001],
  ] as const)
    expect(
      expenseFormSchema('USD').safeParse({ ...values, [field]: 'x'.repeat(length) }).success,
    ).toBe(false);
  expect(expenseFormSchema('USD').safeParse({ ...values, notes: '   ' }).success).toBe(false);
  expect(voidSchema.safeParse({ reason: ' ' }).success).toBe(false);
  expect(voidSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
});
it('keeps real business dates without adding unsupported future-date policy', () => {
  expect(
    expenseFormSchema('USD').safeParse({ ...input('1'), expenseDate: '2025-02-29' }).success,
  ).toBe(false);
  expect(
    expenseFormSchema('USD').safeParse({ ...input('1'), expenseDate: '2096-02-29' }).success,
  ).toBe(true);
  expect(
    validFilters({ ...defaultFilters, expenseDateFrom: '2026-10-02', expenseDateTo: '2026-10-01' }),
  ).toBe(false);
  expect(
    validFilters({ ...defaultFilters, expenseDateFrom: '2000-01-01', expenseDateTo: '2026-10-01' }),
  ).toBe(false);
});
it('rejects tenant/currency/category/ETag contamination and missing void evidence', () => {
  const e = expenseFixture();
  const headers = new Headers({ ETag: '"3"' });
  expect(parseExpense({ data: e }, headers, org.id, 'USD', e.id).etag).toBe('"3"');
  for (const row of [
    { ...e, organizationId: expenseId },
    { ...e, currency: 'INR' },
    { ...e, categoryId: expenseId },
    { ...e, amount: '40.001' },
    { ...e, status: 'VOIDED' },
  ])
    expect(() => parseExpense({ data: row }, headers, org.id, 'USD')).toThrow();
  expect(() => parseExpense({ data: e }, new Headers({ ETag: '"4"' }), org.id, 'USD')).toThrow();
  expect(() =>
    parseCategory({ data: categoryFixture({ organizationId: expenseId }) }, org.id),
  ).toThrow();
  expect(
    parseExpense({ data: voidedFixture() }, new Headers({ ETag: '"4"' }), org.id, 'USD').expense
      .status,
  ).toBe('VOIDED');
});
it('checks scoped list metadata, duplicates and isolated account/category keys', () => {
  const page = { data: [expenseFixture()], meta: { limit: 25, hasMore: false, nextCursor: null } };
  const parse = (row: unknown) => validateExpense(row, org.id, 'USD');
  expect(parsePage(page, 25, parse, (row) => row.id).data).toHaveLength(1);
  expect(() =>
    parsePage({ ...page, data: [expenseFixture(), expenseFixture()] }, 25, parse, (row) => row.id),
  ).toThrow();
  expect(() =>
    parsePage({ ...page, meta: { ...page.meta, hasMore: true } }, 25, parse, (row) => row.id),
  ).toThrow();
  expect(expenseKeys.scope('a', org.id)).not.toEqual(expenseKeys.scope('b', org.id));
  expect(categoryKeys.scope('a', org.id)).not.toEqual(categoryKeys.scope('a', expenseId));
});
it('allowlists only implemented expense and category routes', () => {
  for (const suffix of [
    '/expenses',
    '/expenses/new',
    `/expenses/${expenseId}`,
    `/expenses/${expenseId}/edit`,
    '/expense-categories',
  ]) {
    const route = `/organizations/${org.id}${suffix}`;
    expect(safeReturnTo(route)).toBe(route);
  }
  expect(safeReturnTo(`/organizations/${org.id}/expense-categories/new`)).toBe('/session');
  expect(safeReturnTo(`/organizations/${org.id}/expenses/${expenseId}/restore`)).toBe('/session');
});
