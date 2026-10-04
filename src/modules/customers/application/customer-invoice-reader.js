import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import {
  requireTenantResource,
  tenantResourceWhere,
} from '../../../database/helpers/tenant-query.js';

// Narrow transaction-scoped eligibility contract; invoices do not import the
// customer persistence implementation. The owning transaction provides its client.
@Injectable()
export class CustomerInvoiceReader {
  async active(client, tenant, customerId) {
    const where = tenantResourceWhere(tenant, customerId);
    // FOR SHARE serializes with edit/archive, so the issue snapshot is coherent
    // and an archived customer cannot race a new invoice or issue operation.
    await client.$queryRaw`SELECT "id" FROM "customers" WHERE "organizationId" = ${where.organizationId}::uuid AND "id" = ${where.id}::uuid FOR SHARE`;
    const customer = requireTenantResource(await client.customer.findFirst({ where }), 'Customer');
    if (customer.status !== 'ACTIVE')
      throw new ApplicationError(ERROR_CODES.INVALID_INVOICE_STATE, 'Customer is archived.');
    return { id: customer.id, displayName: customer.displayName, email: customer.email };
  }
}
