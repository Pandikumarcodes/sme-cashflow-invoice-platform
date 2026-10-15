import { uuid } from '../reports/contracts';
import type { AuditEntry } from './contracts';

// Verified application writer codes. Unknown actions retain their code in details.
const actionLabels: Record<string, string> = {
  CUSTOMER_CREATED: 'Customer created',
  CUSTOMER_UPDATED: 'Customer updated',
  CUSTOMER_ARCHIVED: 'Customer archived',
  INVOICE_CREATED: 'Invoice created',
  INVOICE_UPDATED: 'Invoice updated',
  INVOICE_ISSUED: 'Invoice issued',
  INVOICE_CANCELLED: 'Invoice cancelled',
  INVOICE_VOIDED: 'Invoice voided',
  INVOICE_DELETED: 'Invoice deleted',
  PAYMENT_RECORDED: 'Payment recorded',
  PAYMENT_REVERSED: 'Payment reversed',
  EXPENSE_CREATED: 'Expense created',
  EXPENSE_UPDATED: 'Expense updated',
  EXPENSE_VOIDED: 'Expense voided',
  EXPENSE_CATEGORY_CREATED: 'Expense category created',
  EXPENSE_CATEGORY_UPDATED: 'Expense category updated',
  EXPENSE_CATEGORY_ARCHIVED: 'Expense category archived',
  ORGANIZATION_CREATED: 'Organization created',
  ORGANIZATION_UPDATED: 'Organization updated',
  ORGANIZATION_CLOSED: 'Organization closed',
  ORGANIZATION_INVITATION_CREATED: 'Invitation created',
  ORGANIZATION_INVITATION_REVOKED: 'Invitation revoked',
  ORGANIZATION_INVITATION_ACCEPTED: 'Invitation accepted',
  ORGANIZATION_OWNERSHIP_TRANSFERRED: 'Ownership transferred',
  MEMBERSHIP_REACTIVATED: 'Membership reactivated',
  MEMBERSHIP_REMOVED: 'Membership removed',
  MEMBERSHIP_ROLE_CHANGED: 'Membership role changed',
  MEMBERSHIP_SUSPENDED: 'Membership suspended',
  'report.export.request': 'Report export requested',
  'report.export.download': 'Report export downloaded',
};
export function auditActionLabel(action: string) {
  return Object.hasOwn(actionLabels, action) ? actionLabels[action] : 'Recorded activity';
}
export function auditResourceLabel(entity: string) {
  const labels: Record<string, string> = {
    Organization: 'Organization',
    Membership: 'Membership',
    OrganizationInvitation: 'Invitation',
    Customer: 'Customer',
    Invoice: 'Invoice',
    Payment: 'Payment',
    Expense: 'Expense',
    ExpenseCategory: 'Expense category',
    ReportExport: 'Report export',
  };
  return Object.hasOwn(labels, entity) ? labels[entity] : 'Resource';
}
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
