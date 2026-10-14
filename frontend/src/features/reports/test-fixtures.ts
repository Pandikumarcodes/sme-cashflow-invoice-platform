import type { ReportExport } from './contracts';
export const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const exportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const instant = '2026-10-12T10:00:00.000Z';
export function exportFixture(overrides: Partial<ReportExport> = {}): ReportExport {
  return {
    id: exportId,
    organizationId: orgId,
    reportType: 'INVOICE_REGISTER',
    format: 'CSV',
    parameters: { fromDate: '2026-10-01', toDate: '2026-10-31', asOfDate: '2026-10-12' },
    status: 'PENDING',
    rowCount: null,
    errorCode: null,
    completedAt: null,
    expiresAt: null,
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  };
}
export const page = (data: unknown[], limit = 25, nextCursor: string | null = null) => ({
  data,
  meta: { limit, hasMore: nextCursor !== null, nextCursor },
});
export const auditFixture = (overrides: Record<string, unknown> = {}) => ({
  id: exportId,
  organizationId: orgId,
  actorType: 'USER',
  actorUserId: orgId,
  actorMembershipId: null,
  action: 'invoice.issued',
  entityType: 'Invoice',
  entityId: exportId,
  outcome: 'SUCCESS',
  source: 'API',
  occurredAt: instant,
  requestId: 'request-1',
  correlationId: null,
  changedFields: ['status'],
  beforeData: { status: 'DRAFT' },
  afterData: { status: 'ISSUED' },
  metadata: null,
  ...overrides,
});
