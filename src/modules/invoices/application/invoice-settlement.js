import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { Decimal } from '../../../common/money/decimal.js';
import {
  requireTenantResource,
  tenantResourceWhere,
} from '../../../database/helpers/tenant-query.js';
import { settlementState } from '../domain/invoice-policy.js';
import { moneyString } from '../../../common/money/decimal.js';

// Narrow Invoice-owned contract: Payments supplies its transaction client and
// authoritative active sum. It cannot mutate issued document fields through it.
@Injectable()
export class InvoiceSettlement {
  async find(client, tenant, invoiceId) {
    return requireTenantResource(
      await client.invoice.findFirst({ where: tenantResourceWhere(tenant, invoiceId) }),
      'Invoice',
    );
  }

  async lock(client, tenant, invoiceId) {
    const where = tenantResourceWhere(tenant, invoiceId);
    await client.$queryRaw`SELECT "id" FROM "invoices" WHERE "organizationId" = ${where.organizationId}::uuid AND "id" = ${where.id}::uuid FOR UPDATE`;
    return this.find(client, tenant, invoiceId);
  }

  requireIssued(invoice) {
    if (invoice.status !== 'ISSUED')
      throw new ApplicationError(
        ERROR_CODES.INVALID_INVOICE_STATE,
        'Invoice must be issued to accept payment changes.',
      );
  }

  verify(invoice, activeTotal) {
    const paid = new Decimal(activeTotal);
    const balance = new Decimal(invoice.total).sub(paid);
    if (
      paid.isNegative() ||
      balance.isNegative() ||
      !paid.eq(invoice.amountPaid) ||
      !balance.eq(invoice.balanceDue)
    )
      throw new ApplicationError(
        ERROR_CODES.INVOICE_SETTLEMENT_INCONSISTENT,
        'Invoice settlement requires review.',
      );
  }

  async apply(client, tenant, invoice, activeTotal) {
    const paid = new Decimal(activeTotal);
    const balance = new Decimal(invoice.total).sub(paid);
    if (paid.isNegative() || balance.isNegative())
      throw new ApplicationError(
        ERROR_CODES.INVOICE_SETTLEMENT_INCONSISTENT,
        'Invoice settlement requires review.',
      );
    return client.invoice.update({
      where: { ...tenantResourceWhere(tenant, invoice.id), status: 'ISSUED' },
      data: {
        amountPaid: new Prisma.Decimal(paid.toString()),
        balanceDue: new Prisma.Decimal(balance.toString()),
        version: { increment: 1 },
      },
    });
  }

  summary(invoice, timezone) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      paymentState: settlementState(invoice, timezone).paymentState,
      amountPaid: moneyString(invoice.amountPaid, invoice.currency),
      balanceDue: moneyString(invoice.balanceDue, invoice.currency),
      version: invoice.version,
    };
  }
}
