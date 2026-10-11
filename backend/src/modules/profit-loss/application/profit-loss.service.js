import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { ProfitLossReader } from '../../financial/infrastructure/profit-loss-reader.js';
import { profitLossOptions } from '../../financial/domain/profit-loss.js';

@Injectable()
export class ProfitLossService {
  constructor(persistence, authorization, reader) {
    this.persistence = persistence;
    this.authorization = authorization;
    this.reader = reader;
  }
  async get(context, query) {
    requireTenantContext(context);
    const client = await this.persistence.getClient();
    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const { tenant, membership } = await resolveTenantAccess(
          tx,
          context,
          context.organizationId,
          this.authorization,
          [PERMISSIONS.ANALYTICS_READ],
        );
        const organization = membership.organization;
        return this.reader.read(
          tx,
          tenant,
          profitLossOptions(query, organization.timezone),
          organization,
        );
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
Inject(PrismaService)(ProfitLossService, undefined, 0);
Inject(AuthorizationService)(ProfitLossService, undefined, 1);
Inject(ProfitLossReader)(ProfitLossService, undefined, 2);
