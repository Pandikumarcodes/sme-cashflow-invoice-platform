import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';

export function businessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01')
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Date must use YYYY-MM-DD.');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Date is not a valid calendar date.');
  return date;
}
