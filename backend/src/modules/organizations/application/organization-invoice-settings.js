import { Injectable } from '@nestjs/common';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import { requireTenantResource } from '../../../database/helpers/tenant-query.js';

@Injectable()
export class OrganizationInvoiceSettings {
  async lock(client, tenant, lockCurrency = false) {
    requireTenantContext(tenant);
    await client.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${tenant.organizationId}::uuid FOR UPDATE`;
    const organization = requireTenantResource(
      await client.organization.findFirst({
        where: { id: tenant.organizationId, status: 'ACTIVE' },
      }),
      'Organization',
    );
    if (lockCurrency && organization.currencyLockedAt === null) {
      return client.organization.update({
        where: { id: tenant.organizationId },
        data: { currencyLockedAt: new Date(), version: { increment: 1 } },
      });
    }
    return organization;
  }
}
