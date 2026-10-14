import { uuid } from '../reports/contracts';
import type { AuditEntry } from './contracts';
export function auditDestination(
  row: AuditEntry,
  org: string,
  permission: (value: string) => boolean,
) {
  if (row.organizationId !== org || !uuid.safeParse(row.entityId).success) return null;
  const routes: Record<string, readonly [string, string]> = {
    Invoice: ['invoices', 'invoice.read'],
    Customer: ['customers', 'customer.read'],
    Payment: ['payments', 'payment.read'],
    Expense: ['expenses', 'expense.read'],
  };
  if (row.entityType === 'ReportExport')
    return permission('report.export')
      ? `/organizations/${org}/reports?exportId=${row.entityId}`
      : null;
  if (!Object.hasOwn(routes, row.entityType)) return null;
  const [route, required] = routes[row.entityType]!;
  return permission(required) ? `/organizations/${org}/${route}/${row.entityId}` : null;
}
