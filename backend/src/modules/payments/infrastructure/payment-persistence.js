import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  requireTenantResource,
  tenantResourceWhere,
  tenantWhere,
} from '../../../database/helpers/tenant-query.js';

export const PAYMENT_INCLUDE = {
  reversal: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      amountPaid: true,
      balanceDue: true,
      total: true,
      dueDate: true,
      version: true,
    },
  },
};

@Injectable()
export class PaymentPersistence {
  async find(client, tenant, paymentId, lock = false) {
    const where = tenantResourceWhere(tenant, paymentId);
    if (lock)
      await client.$queryRaw`SELECT "id" FROM "payments" WHERE "organizationId" = ${where.organizationId}::uuid AND "id" = ${where.id}::uuid FOR UPDATE`;
    return requireTenantResource(
      await client.payment.findFirst({ where, include: PAYMENT_INCLUDE }),
      'Payment',
    );
  }

  async activeTotal(client, tenant, invoiceId) {
    const result = await client.payment.aggregate({
      where: tenantWhere(tenant, { invoiceId, status: 'RECORDED' }),
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal('0');
  }
}
