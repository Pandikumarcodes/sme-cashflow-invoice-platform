import { Injectable } from '@nestjs/common';
import { tenantWhere } from '../../../database/helpers/tenant-query.js';

@Injectable()
export class ReportPersistence {
  find(tx, tenant, id) {
    return tx.reportExport.findFirst({ where: tenantWhere(tenant, { id }) });
  }
  async lock(tx, organizationId, id) {
    const rows =
      await tx.$queryRaw`SELECT * FROM report_exports WHERE "organizationId" = ${organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }
  audit(tx, tenant, row, action, metadata = {}) {
    return tx.auditLog.create({
      data: {
        organizationId: tenant.organizationId,
        actorType: 'USER',
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        actorSessionId: tenant.sessionId,
        source: 'API',
        outcome: 'SUCCESS',
        action,
        entityType: 'ReportExport',
        entityId: row.id,
        changedFields:
          action === 'report.export.request' ? ['reportType', 'format', 'parameters'] : [],
        afterData: { reportType: row.reportType, format: row.format },
        requestId: metadata.requestId,
        correlationId: metadata.correlationId,
      },
    });
  }
}
