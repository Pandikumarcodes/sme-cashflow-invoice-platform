import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import {
  requireTenantResource,
  tenantResourceWhere,
} from '../../../database/helpers/tenant-query.js';

export const INVOICE_INCLUDE = {
  items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  customer: { select: { displayName: true, email: true } },
};

// Invoice-specific lock and allocation boundary. It never starts a transaction
// and cannot use a root client implicitly: the application supplies its client.
@Injectable()
export class InvoicePersistence {
  async find(client, tenant, id, lock = false) {
    const where = tenantResourceWhere(tenant, id);
    if (lock)
      await client.$queryRaw`SELECT "id" FROM "invoices" WHERE "organizationId" = ${where.organizationId}::uuid AND "id" = ${where.id}::uuid FOR UPDATE`;
    return requireTenantResource(
      await client.invoice.findFirst({ where, include: INVOICE_INCLUDE }),
      'Invoice',
    );
  }

  async allocate(client, tenant, organization) {
    requireTenantContext(tenant);
    await client.$queryRaw`SELECT "organizationId" FROM "invoice_sequences" WHERE "organizationId" = ${tenant.organizationId}::uuid FOR UPDATE`;
    const sequence = requireTenantResource(
      await client.invoiceSequence.findUnique({ where: { organizationId: tenant.organizationId } }),
      'Invoice sequence',
    );
    const next = sequence.nextValue;
    if (next >= 9223372036854775807n)
      throw new ApplicationError(
        ERROR_CODES.DUPLICATE_INVOICE_NUMBER,
        'Invoice numbering capacity is exhausted.',
      );
    const number =
      organization.invoicePrefix + next.toString().padStart(organization.invoiceNumberPadding, '0');
    if (number.length > 40)
      throw new ApplicationError(
        ERROR_CODES.DUPLICATE_INVOICE_NUMBER,
        'Invoice number exceeds supported bounds.',
      );
    await client.invoiceSequence.update({
      where: { organizationId: tenant.organizationId },
      data: { nextValue: { increment: 1n } },
    });
    return { invoiceNumber: number, sequenceValue: next, numberPrefix: organization.invoicePrefix };
  }
}
