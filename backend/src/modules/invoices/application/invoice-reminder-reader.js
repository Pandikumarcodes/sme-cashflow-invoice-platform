import { Injectable } from '@nestjs/common';
import { Decimal } from '../../../common/money/decimal.js';

// Narrow system-worker read contract. The queue IDs are hints: every source is
// fenced by organization, and the authoritative current receipts determine balance.
@Injectable()
export class InvoiceReminderReader {
  async load(tx, organizationId, invoiceId, lock = false) {
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization) return null;
    if (lock)
      await tx.$queryRaw`SELECT id FROM invoices WHERE "organizationId" = ${organizationId}::uuid AND id = ${invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: { organizationId, id: invoiceId },
      include: { customer: true },
    });
    if (!invoice) return null;
    const [sum] = await tx.$queryRaw`SELECT COALESCE(SUM(amount), 0) AS paid,
      COALESCE(bool_or(currency <> ${organization.baseCurrency}), false) AS mismatch
      FROM payments WHERE "organizationId" = ${organizationId}::uuid AND "invoiceId" = ${invoiceId}::uuid AND status = 'RECORDED'`;
    return {
      organization,
      invoice,
      customer: invoice.customer,
      balance: new Decimal(invoice.total).minus(sum.paid),
      currencyMismatch: sum.mismatch || invoice.currency !== organization.baseCurrency,
    };
  }
}
