import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { tenantWhere } from '../../../database/helpers/tenant-query.js';
import { auditOptions, auditCursor, auditFilter } from '../domain/audit-query.js';
import { toAuditResponse } from '../domain/audit-response.js';

@Injectable()
export class AuditLogsService {
  constructor(persistence, authorization) {
    this.persistence = persistence;
    this.authorization = authorization;
  }
  async list(context, query = {}) {
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
          [PERMISSIONS.AUDIT_READ],
        );
        const options = auditOptions(
          tenant.organizationId,
          query,
          membership.organization.timezone,
        );
        const rows = await tx.auditLog.findMany({
          where: tenantWhere(tenant, auditFilter(options)),
          orderBy: [{ occurredAt: options.sortOrder }, { id: options.sortOrder }],
          take: options.limit + 1,
          select: {
            id: true,
            organizationId: true,
            actorType: true,
            actorUserId: true,
            actorMembershipId: true,
            action: true,
            entityType: true,
            entityId: true,
            outcome: true,
            source: true,
            occurredAt: true,
            requestId: true,
            correlationId: true,
            changedFields: true,
            beforeData: true,
            afterData: true,
            metadata: true,
          },
        });
        const hasMore = rows.length > options.limit;
        const page = rows.slice(0, options.limit);
        return {
          data: page.map(toAuditResponse),
          meta: {
            limit: options.limit,
            hasMore,
            nextCursor: hasMore ? auditCursor(page.at(-1), options) : null,
          },
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
Inject(PrismaService)(AuditLogsService, undefined, 0);
Inject(AuthorizationService)(AuditLogsService, undefined, 1);
