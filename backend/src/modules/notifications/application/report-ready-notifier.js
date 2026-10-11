import { Injectable } from '@nestjs/common';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';

// Reports passes its already reauthorized requester and transaction. Notification
// persistence remains owned here and completion shares the same commit.
@Injectable()
export class ReportReadyNotifier {
  append(tx, tenant, exportId) {
    requireTenantContext(tenant);
    return tx.notification.createMany({
      data: [
        {
          organizationId: tenant.organizationId,
          recipientUserId: tenant.userId,
          type: 'REPORT_READY',
          title: 'Report ready',
          body: 'Your requested CSV report is ready to download.',
          relatedEntityType: 'ReportExport',
          relatedEntityId: exportId,
          deduplicationKey: `report-ready-${exportId}`,
        },
      ],
      skipDuplicates: true,
    });
  }
}
