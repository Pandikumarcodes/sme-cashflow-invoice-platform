import { calculateInvoice } from './invoice-calculator.js';
import { Decimal, roundMoney } from '../../../common/money/decimal.js';

const line = (quantity = '3', unitPrice = '33.335', sortOrder = 0) => ({
  description: 'Consulting',
  quantity,
  unitPrice,
  sortOrder,
});
const input = (overrides = {}) => ({
  items: [line()],
  discount: { type: 'NONE', value: '0' },
  taxRate: '0',
  ...overrides,
});
const calc = (overrides, currency = 'INR') => calculateInvoice(input(overrides), currency);

describe('invoice Decimal calculation', () => {
  it('rounds each line half away from zero before summing, without binary float loss', () => {
    expect(calc().items[0].lineAmount.toFixed(2)).toBe('100.01');
    const result = calc({ items: [line('1', '0.005', 0), line('1', '0.005', 1)] });
    expect(result.values.total.toFixed(2)).toBe('0.02');
    expect(calc({ items: [line('0.1', '0.2')] }).values.total.toFixed(2)).toBe('0.02');
    expect(calc({ items: [line('1', '0.0049')] }).values.total.toFixed(2)).toBe('0.00');
  });
  it('applies percentage discount, then tax, each rounded separately', () => {
    const result = calc({ discount: { type: 'PERCENTAGE', value: '10' }, taxRate: '18' }).values;
    expect(
      Object.fromEntries(
        ['subtotal', 'discountTotal', 'taxableTotal', 'taxTotal', 'total', 'balanceDue'].map(
          (field) => [field, result[field].toFixed(2)],
        ),
      ),
    ).toEqual({
      subtotal: '100.01',
      discountTotal: '10.00',
      taxableTotal: '90.01',
      taxTotal: '16.20',
      total: '106.21',
      balanceDue: '106.21',
    });
    expect(result.amountPaid.toString()).toBe('0');
  });
  it('supports fixed discount, zero total drafts, and currency registry scales', () => {
    expect(calc({ discount: { type: 'FIXED', value: '100.01' } }).values.total.toString()).toBe(
      '0',
    );
    expect(calc({}, 'JPY').values.total.toString()).toBe('100');
    expect(calc({}, 'KWD').values.total.toFixed(3)).toBe('100.005');
  });
  it('preserves maximum supported inputs exactly and rejects computed overflow', () => {
    expect(calc({ items: [line('1', '999999999999999.99')] }).values.total.toFixed(2)).toBe(
      '999999999999999.99',
    );
    expect(() => calc({ items: [line('2', '999999999999999.99')] })).toThrow(
      expect.objectContaining({ code: 'INVALID_MONEY' }),
    );
    expect(() => calc({ items: [line('1', '999999999999999.9999')] })).toThrow();
    expect(new Decimal('0.1').add('0.2').toString()).toBe('0.3');
    expect(roundMoney(new Decimal('1.005'), 2).toString()).toBe('1.01');
  });
  it.each(['0', '-1', '1e2', 'NaN', ' 1', '1.0000001', 1])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(() => calc({ items: [line(quantity)] })).toThrow(
        expect.objectContaining({ code: 'INVALID_QUANTITY' }),
      );
    },
  );
  it.each(['-1', '1.00001', '1e2', 1])('rejects invalid unit price %s', (unitPrice) => {
    expect(() => calc({ items: [line('1', unitPrice)] })).toThrow(
      expect.objectContaining({ code: 'INVALID_MONEY' }),
    );
  });
  it.each([
    { type: 'NONE', value: '1' },
    { type: 'PERCENTAGE', value: '100.000001' },
    { type: 'FIXED', value: '100.02' },
    { type: 'FIXED', value: '0.001' },
  ])('rejects invalid discount %s', (discount) => {
    expect(() => calc({ discount })).toThrow(expect.objectContaining({ code: 'INVALID_DISCOUNT' }));
  });
  it('validates tax bounds, item descriptions and unique nonnegative sort orders', () => {
    expect(() => calc({ discount: { type: 'FIXED', value: '10000000000000' } })).toThrow(
      expect.objectContaining({ code: 'INVALID_DISCOUNT' }),
    );
    expect(() => calc({ taxRate: '100.000001' })).toThrow(
      expect.objectContaining({ code: 'INVALID_TAX' }),
    );
    expect(() => calc({ items: [] })).toThrow();
    expect(() => calc({ items: [{ ...line(), description: ' ' }] })).toThrow();
    expect(() => calc({ items: [line(), line()] })).toThrow();
    expect(() => calc({ items: [line('1', '1', -1)] })).toThrow();
  });
});
