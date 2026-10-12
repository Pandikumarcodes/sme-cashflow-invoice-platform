import Decimal from 'decimal.js-light';
export const InvoiceDecimal = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_UP });
export const moneyPattern = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;
export const quantityPattern = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
export const ratePattern = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/;
export function currencyScale(currency: string) {
  const scale =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  if (scale > 4) throw new Error('Unsupported currency.');
  return scale;
}
export type CalculationInput = {
  items: { description: string; quantity: string; unitPrice: string; sortOrder: number }[];
  discount: { type: 'NONE' | 'FIXED' | 'PERCENTAGE'; value: string };
  taxRate: string;
};
export function previewInvoice(input: CalculationInput, currency: string) {
  const scale = currencyScale(currency);
  const round = (amount: Decimal) => {
    const rounded = amount.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    if (rounded.isNegative() || rounded.gt('999999999999999.9999'))
      throw new Error('Amount exceeds supported bounds.');
    return rounded;
  };
  if (!input.items.length || input.items.length > 1000) throw new Error('Use 1–1,000 items.');
  const orders = new Set<number>();
  const lines = input.items.map((item) => {
    if (
      !/\S/.test(item.description) ||
      item.description.length > 500 ||
      !quantityPattern.test(item.quantity) ||
      !moneyPattern.test(item.unitPrice) ||
      !Number.isInteger(item.sortOrder) ||
      item.sortOrder < 0 ||
      item.sortOrder > 2147483647 ||
      orders.has(item.sortOrder)
    )
      throw new Error('Check item descriptions, quantities and prices.');
    orders.add(item.sortOrder);
    const quantity = new InvoiceDecimal(item.quantity);
    if (quantity.lte('0')) throw new Error('Quantity must be positive.');
    return round(quantity.mul(item.unitPrice));
  });
  const subtotal = round(lines.reduce((sum, line) => sum.add(line), new InvoiceDecimal('0')));
  const { type, value } = input.discount;
  if (!(type === 'PERCENTAGE' ? ratePattern : moneyPattern).test(value))
    throw new Error('Check discount precision.');
  const discount = new InvoiceDecimal(value);
  if (
    (type === 'NONE' && !discount.isZero()) ||
    (type === 'PERCENTAGE' && discount.gt('100')) ||
    (type === 'FIXED' && (discount.gt('9999999999999.999999') || discount.decimalPlaces() > scale))
  )
    throw new Error('Check discount bounds and currency precision.');
  const discountTotal = round(type === 'PERCENTAGE' ? subtotal.mul(discount).div('100') : discount);
  if (discountTotal.gt(subtotal)) throw new Error('Discount exceeds subtotal.');
  if (!ratePattern.test(input.taxRate) || new InvoiceDecimal(input.taxRate).gt('100'))
    throw new Error('Tax rate must be between 0 and 100.');
  const taxableTotal = round(subtotal.sub(discountTotal));
  const taxTotal = round(taxableTotal.mul(input.taxRate).div('100'));
  return {
    lines: lines.map((line) => line.toFixed(scale)),
    subtotal: subtotal.toFixed(scale),
    discountTotal: discountTotal.toFixed(scale),
    taxableTotal: taxableTotal.toFixed(scale),
    taxTotal: taxTotal.toFixed(scale),
    total: round(taxableTotal.add(taxTotal)).toFixed(scale),
  };
}
export function formatInvoiceMoney(value: string, currency: string) {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  const [integer, fraction] = new InvoiceDecimal(value).toFixed(currencyScale(currency)).split('.');
  const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    BigInt(integer!),
  );
  return formatter
    .formatToParts(1n)
    .map((part) =>
      part.type === 'integer' ? grouped : part.type === 'fraction' ? fraction : part.value,
    )
    .join('');
}
