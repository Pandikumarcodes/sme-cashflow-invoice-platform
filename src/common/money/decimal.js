import { Prisma } from '@prisma/client';
import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';

// A private Decimal constructor avoids changing Prisma's global precision.
// 64 significant digits cover products/sums within the approved numeric bounds.
export const Decimal = Prisma.Decimal.clone({
  precision: 64,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
export const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;
export const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
export const RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/;
const MAX_MONEY = new Decimal('999999999999999.9999');

export function decimalInput(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new ApplicationError(code, 'Invalid decimal input.');
  return new Decimal(value);
}

export function currencyScale(currency) {
  const scale = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
  if (scale > 4)
    throw new ApplicationError(ERROR_CODES.INVALID_CURRENCY, 'Currency scale is unsupported.');
  return scale;
}

export function roundMoney(value, scale) {
  const rounded = new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  if (rounded.isNegative() || rounded.gt(MAX_MONEY))
    throw new ApplicationError(
      ERROR_CODES.INVALID_MONEY,
      'Calculated amount exceeds supported bounds.',
    );
  return new Prisma.Decimal(rounded.toFixed(scale));
}

export function moneyString(value, currency) {
  return new Decimal(value).toFixed(currencyScale(currency));
}
