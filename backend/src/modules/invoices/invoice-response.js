import { moneyString } from '../../common/money/decimal.js';
import { settlementState } from './domain/invoice-policy.js';

export function toInvoiceResponse(invoice, timezone, now = new Date()) {
  const result = {
    id: invoice.id,
    organizationId: invoice.organizationId,
    customerId: invoice.customerId,
    status: invoice.status,
    invoiceNumber: invoice.invoiceNumber,
    sequenceValue: invoice.sequenceValue?.toString() ?? null,
    numberPrefix: invoice.numberPrefix,
    customer: {
      id: invoice.customerId,
      displayName: invoice.billToName ?? invoice.customer.displayName,
      email: invoice.status === 'DRAFT' ? invoice.customer.email : invoice.billToEmail,
    },
    ...settlementState(invoice, timezone, now),
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    currency: invoice.currency,
    discount: { type: invoice.discountType, value: invoice.discountValue.toString() },
    taxRate: invoice.taxRate.toString(),
    items: invoice.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toFixed(4),
      lineAmount: moneyString(item.lineAmount, invoice.currency),
      sortOrder: item.sortOrder,
    })),
    createdByUserId: invoice.createdByUserId,
    issuedByUserId: invoice.issuedByUserId,
    issuedAt: invoice.issuedAt,
    cancelledAt: invoice.cancelledAt,
    cancelReason: invoice.cancelReason,
    voidedAt: invoice.voidedAt,
    voidReason: invoice.voidReason,
    version: invoice.version,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
  for (const field of [
    'subtotal',
    'discountTotal',
    'taxableTotal',
    'taxTotal',
    'total',
    'amountPaid',
    'balanceDue',
  ])
    result[field] = moneyString(invoice[field], invoice.currency);
  return result;
}
