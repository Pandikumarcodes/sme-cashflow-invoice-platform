import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { CashFlowReader } from '../../financial/infrastructure/cash-flow-reader.js';
import { cashFlowOptions } from '../../financial/domain/cash-flow.js';

@Injectable()
export class CashFlowService {
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
        const options = cashFlowOptions(query, organization.timezone);
        return this.reader.read(tx, tenant, options, organization);
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
Inject(PrismaService)(CashFlowService, undefined, 0);
Inject(AuthorizationService)(CashFlowService, undefined, 1);
Inject(CashFlowReader)(CashFlowService, undefined, 2);
