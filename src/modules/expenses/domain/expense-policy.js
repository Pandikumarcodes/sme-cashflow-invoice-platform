import { Prisma } from '@prisma/client';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { currencyScale, decimalInput, MONEY_PATTERN } from '../../../common/money/decimal.js';
import { businessDate } from '../../../common/time/business-date.js';

export function expenseText(value, maximum, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new ApplicationError(
      ERROR_CODES.INVALID_REQUEST,
      'Text must be nonblank and within its field limit.',
    );
  return value.trim();
}

export function categoryData(input) {
  const data = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string')
      throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Category name is required.');
    data.name = input.name.trim().replace(/\s+/g, ' ');
    data.normalizedName = data.name.toLowerCase();
    if (!data.name || data.name.length > 100 || data.normalizedName.length > 100)
      throw new ApplicationError(
        ERROR_CODES.VALIDATION_ERROR,
        'Category name must contain 1–100 characters after normalization.',
      );
  }
  if (input.description !== undefined) data.description = expenseText(input.description, 500);
  return data;
}

export function expenseAmount(value, currency) {
  const amount = decimalInput(value, MONEY_PATTERN, ERROR_CODES.INVALID_MONEY);
  if (amount.lte('0') || amount.decimalPlaces() > currencyScale(currency))
    throw new ApplicationError(
      ERROR_CODES.INVALID_MONEY,
      'Expense amount must be positive and obey currency minor units.',
    );
  return new Prisma.Decimal(amount.toString());
}

export function expenseDate(value) {
  try {
    return businessDate(value);
  } catch {
    throw new ApplicationError(
      ERROR_CODES.EXPENSE_INVALID_DATE,
      'Expense date must be a real YYYY-MM-DD calendar date.',
    );
  }
}

export function expenseData(input, currency) {
  const data = {};
  if (input.categoryId !== undefined) data.expenseCategoryId = input.categoryId;
  if (input.amount !== undefined) data.amount = expenseAmount(input.amount, currency);
  if (input.expenseDate !== undefined) data.expenseDate = expenseDate(input.expenseDate);
  for (const [field, limit, nullable] of [
    ['vendorPayee', 200, true],
    ['description', 500, false],
    ['reference', 150, true],
    ['notes', 1000, true],
  ])
    if (input[field] !== undefined) data[field] = expenseText(input[field], limit, nullable);
  return data;
}

export function assertExpenseEditable(expense, expectedVersion, voiding = false) {
  if (expense.status !== 'ACTIVE')
    throw new ApplicationError(
      voiding ? ERROR_CODES.EXPENSE_ALREADY_VOIDED : ERROR_CODES.EXPENSE_NOT_EDITABLE,
      'Expense is already voided.',
    );
  if (expense.version !== expectedVersion)
    throw new ApplicationError(
      ERROR_CODES.CONCURRENT_MODIFICATION,
      'Expense version does not match.',
    );
}
