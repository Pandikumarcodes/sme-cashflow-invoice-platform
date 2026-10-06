import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  CreateCategoryDto,
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseListQueryDto,
} from './expense.dto.js';
import { decodeCursor, listOptions } from '../application/expense-pagination.js';

const errors = (dto, input) =>
  validate(Object.assign(new dto(), input), { whitelist: true, forbidNonWhitelisted: true });
const input = {
  categoryId: randomUUID(),
  amount: '10.25',
  expenseDate: '2026-01-01',
  description: 'Office',
};
describe('expense transport allowlists', () => {
  it('accepts only the approved expense fields and requires all mandatory inputs', async () => {
    expect(
      await errors(CreateExpenseDto, { ...input, vendorPayee: null, reference: null, notes: null }),
    ).toEqual([]);
    for (const field of ['categoryId', 'amount', 'expenseDate', 'description']) {
      const missing = { ...input };
      delete missing[field];
      expect(
        (await errors(CreateExpenseDto, missing)).some((error) => error.property === field),
      ).toBe(true);
    }
    for (const field of [
      'organizationId',
      'currency',
      'version',
      'status',
      'expenseCategoryId',
      'createdByUserId',
    ])
      expect(
        (await errors(CreateExpenseDto, { ...input, [field]: 'server-owned' })).some(
          (error) => error.property === field,
        ),
      ).toBe(true);
  });
  it('permits nullable PATCH clearing only on the three nullable fields', async () => {
    expect(
      await errors(UpdateExpenseDto, { vendorPayee: null, reference: null, notes: null }),
    ).toEqual([]);
    for (const field of ['categoryId', 'amount', 'expenseDate', 'description'])
      expect(await errors(UpdateExpenseDto, { [field]: null })).not.toEqual([]);
    for (const [field, maximum] of [
      ['vendorPayee', 200],
      ['description', 500],
      ['reference', 150],
      ['notes', 1000],
    ]) {
      expect(await errors(UpdateExpenseDto, { [field]: 'x'.repeat(maximum) })).toEqual([]);
      expect(await errors(UpdateExpenseDto, { [field]: 'x'.repeat(maximum + 1) })).not.toEqual([]);
    }
  });
  it('leaves calendar semantics to the domain and prevents Category system-field mutation', async () => {
    expect(await errors(CreateExpenseDto, { ...input, expenseDate: '2026-02-30' })).toEqual([]);
    for (const expenseDate of ['2026/01/01', null, 20260101])
      expect(await errors(CreateExpenseDto, { ...input, expenseDate })).not.toEqual([]);
    for (const field of [
      'id',
      'organizationId',
      'normalizedName',
      'systemKey',
      'status',
      'updatedAt',
    ])
      expect(
        await errors(CreateCategoryDto, { name: 'Category', [field]: 'forbidden' }),
      ).not.toEqual([]);
  });
  it('routes every malformed cursor shape to the bound-cursor safe error', async () => {
    const options = listOptions(randomUUID(), {});
    for (const after of ['', ['one', 'two'], null, 'a'.repeat(2049), 'bad']) {
      expect(await errors(ExpenseListQueryDto, { after })).toEqual([]);
      expect(() => decodeCursor(after, options)).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
    }
  });
});
