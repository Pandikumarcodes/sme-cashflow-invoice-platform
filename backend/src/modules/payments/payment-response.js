import { moneyString } from '../../common/money/decimal.js';

export function toPaymentResponse(payment, invoiceSummary) {
  const reversal = payment.reversal;
  return {
    id: payment.id,
    organizationId: payment.organizationId,
    invoiceId: payment.invoiceId,
    amount: moneyString(payment.amount, payment.currency),
    currency: payment.currency,
    paymentDate: payment.paymentDate.toISOString().slice(0, 10),
    method: payment.paymentMethod,
    status: payment.status,
    createdByUserId: payment.createdByUserId,
    recordedAt: payment.recordedAt,
    reversedAt: payment.reversedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    reversal: reversal
      ? {
          id: reversal.id,
          paymentId: reversal.paymentId,
          amount: moneyString(reversal.amount, payment.currency),
          reason: reversal.reason,
          reversalDate: reversal.reversalDate.toISOString().slice(0, 10),
          reversedByUserId: reversal.reversedByUserId,
          createdAt: reversal.createdAt,
        }
      : null,
    invoice: invoiceSummary,
  };
}
