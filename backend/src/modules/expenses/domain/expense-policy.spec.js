import { Prisma } from '@prisma/client';
import {
  assertExpenseEditable,
  categoryData,
  expenseAmount,
  expenseData,
  expenseDate,
  expenseText,
} from './expense-policy.js';

describe('expense category normalization', () => {
  it('trims, collapses whitespace and lowercases without Unicode transformations', () => {
    expect(categoryData({ name: '  Office\t\n Supplies  ' })).toEqual({
      name: 'Office Supplies',
      normalizedName: 'office supplies',
    });
    expect(categoryData({ name: 'É Ａ' }).normalizedName).toBe('é ａ');
    expect(categoryData({ name: ' A' + ' '.repeat(150) + 'B ' })).toEqual({
      name: 'A B',
      normalizedName: 'a b',
    });
    expect(categoryData({ name: 'x'.repeat(100) }).name).toHaveLength(100);
  });
  it.each(['', ' \t\n ', 'x'.repeat(101), 'İ'.repeat(51), null, 25])(
    'rejects invalid final names %p',
    (name) => {
      expect(() => categoryData({ name })).toThrow();
    },
  );
  it('allows only business fields and trims description', () => {
    expect(
      categoryData({ description: ' details ', systemKey: 'RENT', status: 'ARCHIVED' }),
    ).toEqual({ description: 'details' });
    expect(() => categoryData({ description: 'x'.repeat(501) })).toThrow();
  });
});
describe('authoritative expense money', () => {
  it.each([
    ['INR', '1.23'],
    ['JPY', '1'],
    ['KWD', '1.234'],
    ['CLF', '1.2345'],
    ['INR', '999999999999999.99'],
    ['KWD', '999999999999999.999'],
    ['JPY', '999999999999999'],
    ['INR', '1.2300'],
  ])('stores %s %s as Prisma Decimal without rounding', (currency, amount) => {
    const result = expenseAmount(amount, currency);
    expect(result).toBeInstanceOf(Prisma.Decimal);
    expect(result.equals(amount)).toBe(true);
  });
  it.each([
    ['INR', '0'],
    ['INR', '-1'],
    ['INR', 1],
    ['INR', '1e2'],
    ['INR', ' 1'],
    ['INR', '1,000'],
    ['INR', '01'],
    ['INR', '1000000000000000'],
    ['INR', '1.001'],
    ['JPY', '0.1'],
    ['KWD', '1.0001'],
    ['CLF', '1.00001'],
  ])('rejects %s %p', (currency, amount) => {
    expect(() => expenseAmount(amount, currency)).toThrow(
      expect.objectContaining({ code: 'INVALID_MONEY' }),
    );
  });
});
describe('expense business inputs and lifecycle', () => {
  it.each(['2024-02-29', '0001-01-01', '9999-12-31', '2030-01-01'])(
    'accepts real date %s without a future restriction',
    (value) => {
      expect(expenseDate(value).toISOString().slice(0, 10)).toBe(value);
    },
  );
  it.each(['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01'])(
    'rejects impossible %s',
    (value) => {
      expect(() => expenseDate(value)).toThrow(
        expect.objectContaining({ code: 'EXPENSE_INVALID_DATE' }),
      );
    },
  );
  it('trims bounded text and explicitly clears only nullable fields', () => {
    expect(
      expenseData(
        { vendorPayee: null, reference: null, notes: null, description: ' office ' },
        'INR',
      ),
    ).toEqual({ vendorPayee: null, reference: null, notes: null, description: 'office' });
    for (const value of [null, '', '  ', 'x'.repeat(501)])
      expect(() => expenseText(value, 500)).toThrow();
    expect(expenseText('x'.repeat(500), 500)).toHaveLength(500);
    expect(() => expenseData({ description: null }, 'INR')).toThrow();
  });
  it('checks terminal status before concurrency and distinguishes void repeats', () => {
    expect(() => assertExpenseEditable({ status: 'ACTIVE', version: 2 }, 1)).toThrow(
      expect.objectContaining({ code: 'CONCURRENT_MODIFICATION' }),
    );
    expect(() => assertExpenseEditable({ status: 'VOIDED', version: 2 }, 1)).toThrow(
      expect.objectContaining({ code: 'EXPENSE_NOT_EDITABLE' }),
    );
    expect(() => assertExpenseEditable({ status: 'VOIDED', version: 2 }, 1, true)).toThrow(
      expect.objectContaining({ code: 'EXPENSE_ALREADY_VOIDED' }),
    );
    expect(() => assertExpenseEditable({ status: 'ACTIVE', version: 2 }, 2)).not.toThrow();
  });
});
