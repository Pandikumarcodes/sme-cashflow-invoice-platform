import { Prisma } from '@prisma/client';
import {
  Decimal,
  decimalInput,
  currencyScale,
  roundMoney,
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  RATE_PATTERN,
} from '../../../common/money/decimal.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

export function calculateInvoice(input, currency) {
  const scale = currencyScale(currency);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 1000)
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'At least one item is required.');
  const orders = new Set();
  const items = input.items.map((item) => {
    if (
      typeof item.description !== 'string' ||
      !/\S/.test(item.description) ||
      item.description.length > 500 ||
      !Number.isInteger(item.sortOrder) ||
      item.sortOrder < 0 ||
      item.sortOrder > 2147483647 ||
      orders.has(item.sortOrder)
    )
      throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Invalid invoice item.');
    orders.add(item.sortOrder);
    const quantity = decimalInput(item.quantity, QUANTITY_PATTERN, ERROR_CODES.INVALID_QUANTITY);
    if (quantity.lte('0'))
      throw new ApplicationError(ERROR_CODES.INVALID_QUANTITY, 'Quantity must be positive.');
    const price = decimalInput(item.unitPrice, MONEY_PATTERN, ERROR_CODES.INVALID_MONEY);
    return {
      description: item.description,
      sortOrder: item.sortOrder,
      quantity: new Prisma.Decimal(quantity.toString()),
      unitPrice: new Prisma.Decimal(price.toString()),
      lineAmount: roundMoney(quantity.mul(price), scale),
    };
  });
  const subtotal = roundMoney(
    items.reduce((sum, item) => sum.add(item.lineAmount), new Decimal('0')),
    scale,
  );
  const type = input.discount.type;
  const discount = decimalInput(
    input.discount.value,
    type === 'PERCENTAGE' ? RATE_PATTERN : MONEY_PATTERN,
    ERROR_CODES.INVALID_DISCOUNT,
  );
  if (
    !['NONE', 'FIXED', 'PERCENTAGE'].includes(type) ||
    (type === 'NONE' && !discount.isZero()) ||
    (type === 'PERCENTAGE' && discount.gt('100')) ||
    (type === 'FIXED' && discount.gt('9999999999999.999999')) ||
    (type === 'FIXED' && discount.decimalPlaces() > scale)
  )
    throw new ApplicationError(ERROR_CODES.INVALID_DISCOUNT, 'Discount is invalid.');
  const discountTotal = roundMoney(
    type === 'PERCENTAGE' ? new Decimal(subtotal).mul(discount).div('100') : discount,
    scale,
  );
  if (discountTotal.gt(subtotal))
    throw new ApplicationError(ERROR_CODES.INVALID_DISCOUNT, 'Discount exceeds subtotal.');
  const rate = decimalInput(input.taxRate, RATE_PATTERN, ERROR_CODES.INVALID_TAX);
  if (rate.gt('100'))
    throw new ApplicationError(ERROR_CODES.INVALID_TAX, 'Tax rate must be between zero and 100.');
  const taxableTotal = roundMoney(new Decimal(subtotal).sub(discountTotal), scale);
  const taxTotal = roundMoney(new Decimal(taxableTotal).mul(rate).div('100'), scale);
  const total = roundMoney(new Decimal(taxableTotal).add(taxTotal), scale);
  return {
    items,
    values: {
      discountType: type,
      discountValue: new Prisma.Decimal(discount.toString()),
      taxRate: new Prisma.Decimal(rate.toString()),
      subtotal,
      discountTotal,
      taxableTotal,
      taxTotal,
      total,
      amountPaid: new Prisma.Decimal('0'),
      balanceDue: total,
    },
  };
}
