import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { tenantWhere, requireTenantResource } from '../../../database/helpers/tenant-query.js';
import {
  notificationOptions,
  notificationFilter,
  notificationCursor,
  toNotificationResponse,
} from '../domain/notification.js';

@Injectable()
export class NotificationsService {
  constructor(persistence, authorization) {
    this.persistence = persistence;
    this.authorization = authorization;
  }
  async transaction(context, permission, action) {
    requireTenantContext(context);
    const client = await this.persistence.getClient();
    return client.$transaction(async (tx) => {
      const { tenant } = await resolveTenantAccess(
        tx,
        context,
        context.organizationId,
        this.authorization,
        [permission],
      );
      return action(tx, tenant);
    });
  }
  list(context, query = {}) {
    return this.transaction(context, PERMISSIONS.NOTIFICATION_READ, async (tx, tenant) => {
      const options = notificationOptions(tenant, query);
      const rows = await tx.notification.findMany({
        where: tenantWhere(tenant, {
          recipientUserId: tenant.userId,
          ...notificationFilter(options, query.after),
        }),
        orderBy: [{ createdAt: options.sortOrder }, { id: options.sortOrder }],
        take: options.limit + 1,
      });
      const hasMore = rows.length > options.limit;
      const page = rows.slice(0, options.limit);
      return {
        data: page.map(toNotificationResponse),
        meta: {
          limit: options.limit,
          hasMore,
          nextCursor: hasMore ? notificationCursor(page.at(-1), options) : null,
        },
      };
    });
  }
  markRead(context, id) {
    return this.changeState(context, id, false);
  }
  archive(context, id) {
    return this.changeState(context, id, true);
  }
  changeState(context, id, archive) {
    return this.transaction(context, PERMISSIONS.NOTIFICATION_UPDATE_SELF, async (tx, tenant) => {
      const where = tenantWhere(tenant, { id, recipientUserId: tenant.userId });
      // Conditional writes preserve the original timestamps under retries and races.
      await tx.notification.updateMany({
        where: { AND: [where, archive ? { status: { not: 'ARCHIVED' } } : { status: 'UNREAD' }] },
        data: archive
          ? { status: 'ARCHIVED', archivedAt: new Date() }
          : { status: 'READ', readAt: new Date() },
      });
      return {
        data: toNotificationResponse(
          requireTenantResource(await tx.notification.findFirst({ where }), 'Notification'),
        ),
      };
    });
  }
}
Inject(PrismaService)(NotificationsService, undefined, 0);
Inject(AuthorizationService)(NotificationsService, undefined, 1);
