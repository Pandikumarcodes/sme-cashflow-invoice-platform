import { Prisma } from '@prisma/client';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import {
  Decimal,
  currencyScale,
  decimalInput,
  MONEY_PATTERN,
} from '../../../common/money/decimal.js';
import { businessDate } from '../../../common/time/business-date.js';

export const PAYMENT_METHODS = Object.freeze([
  'CASH',
  'BANK_TRANSFER',
  'UPI',
  'CHEQUE',
  'CARD_EXTERNAL',
  'OTHER',
]);

export function paymentAmount(value, currency) {
  const amount = decimalInput(value, MONEY_PATTERN, ERROR_CODES.INVALID_PAYMENT_AMOUNT);
  if (amount.lte('0') || amount.decimalPlaces() > currencyScale(currency))
    throw new ApplicationError(
      ERROR_CODES.INVALID_PAYMENT_AMOUNT,
      'Payment amount must be positive and obey currency minor units.',
    );
  return new Prisma.Decimal(amount.toString());
}

export function assertWithinBalance(total, activeTotal, amount, currency) {
  const remaining = new Decimal(total).sub(activeTotal);
  if (remaining.isNegative())
    throw new ApplicationError(
      ERROR_CODES.INVOICE_SETTLEMENT_INCONSISTENT,
      'Invoice settlement requires review.',
    );
  if (new Decimal(amount).gt(remaining))
    throw new ApplicationError(
      ERROR_CODES.PAYMENT_EXCEEDS_BALANCE,
      'Payment amount exceeds the outstanding invoice balance.',
      { currency, remainingBalance: remaining.toFixed(currencyScale(currency)) },
    );
}

export function paymentDate(value) {
  try {
    return businessDate(value);
  } catch {
    throw new ApplicationError(
      ERROR_CODES.INVALID_PAYMENT_DATE,
      'Payment date must be a valid YYYY-MM-DD calendar date.',
    );
  }
}

export function reversalInput(input) {
  if (typeof input.reason !== 'string' || !/\S/.test(input.reason) || input.reason.length > 500)
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Reversal reason is required.');
  return { reason: input.reason.trim(), reversalDate: paymentDate(input.reversalDate) };
}
