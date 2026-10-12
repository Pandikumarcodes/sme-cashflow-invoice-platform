import type { Notification } from './contracts';
import { organizationIdPattern } from '../../organizations/contracts';
const labels: Record<string, string> = {
  INVOICE_DUE_SOON: 'Invoice due-soon reminder',
  INVOICE_OVERDUE: 'Invoice overdue reminder',
  PAYMENT_RECORDED: 'Payment recorded',
  REPORT_READY: 'Report ready',
  SYSTEM: 'System activity',
};
export function notificationLabel(type: string) {
  return Object.hasOwn(labels, type) ? labels[type] : 'Activity';
}
const destinations = {
  Invoice: ['invoices', 'invoice.read'],
  Payment: ['payments', 'payment.read'],
  Customer: ['customers', 'customer.read'],
} as const;
export function notificationDestination(
  row: Notification,
  org: string,
  hasPermission: (permission: string) => boolean,
): string | null {
  if (
    row.organizationId !== org ||
    !organizationIdPattern.test(org) ||
    !row.relatedEntityId ||
    !organizationIdPattern.test(row.relatedEntityId) ||
    !row.relatedEntityType ||
    !Object.hasOwn(destinations, row.relatedEntityType)
  )
    return null;
  const [route, permission] = destinations[row.relatedEntityType as keyof typeof destinations];
  return hasPermission(permission) ? `/organizations/${org}/${route}/${row.relatedEntityId}` : null;
}
export function notificationTimestamp(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
