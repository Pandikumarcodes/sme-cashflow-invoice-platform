import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { AnalyticsReader } from '../../financial/infrastructure/analytics-reader.js';
import { analyticsOptions } from '../../financial/domain/analytics.js';

@Injectable()
export class AnalyticsService {
  constructor(persistence, authorization, reader) {
    this.persistence = persistence;
    this.authorization = authorization;
    this.reader = reader;
  }
  async summary(context, query) {
    return this.read(context, query, true);
  }
  async aging(context, query) {
    return this.read(context, query, false);
  }
  async read(context, query, summary) {
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
        return this.reader[summary ? 'summary' : 'aging'](
          tx,
          tenant,
          analyticsOptions(query, organization.timezone, summary),
          organization,
        );
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
Inject(PrismaService)(AnalyticsService, undefined, 0);
Inject(AuthorizationService)(AnalyticsService, undefined, 1);
Inject(AnalyticsReader)(AnalyticsService, undefined, 2);
