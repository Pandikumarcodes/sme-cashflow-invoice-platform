// UI hints mirror the backend canonical map. Server authorization remains authoritative.
export const permissions = [
  'organization.read',
  'organization.update',
  'organization.close',
  'organization.transfer_ownership',
  'membership.read',
  'membership.invite',
  'membership.change_role',
  'membership.suspend',
  'membership.remove',
  'customer.read',
  'customer.create',
  'customer.update',
  'customer.archive',
  'invoice.read',
  'invoice.create',
  'invoice.update_draft',
  'invoice.delete_draft',
  'invoice.issue',
  'invoice.cancel',
  'invoice.void',
  'payment.read',
  'payment.create',
  'payment.reverse',
  'expense.read',
  'expense.create',
  'expense.update',
  'expense.void',
  'expense_category.manage',
  'analytics.read',
  'report.read',
  'report.export',
  'notification.read',
  'notification.update_self',
  'audit.read',
] as const;
export type Permission = (typeof permissions)[number];
const rolePermissions: Record<string, readonly Permission[]> = {
  OWNER: permissions,
  ADMIN: permissions.filter(
    (p) => p !== 'organization.close' && p !== 'organization.transfer_ownership',
  ),
  ACCOUNTANT: permissions.filter(
    (p) =>
      p === 'organization.read' || (!p.startsWith('organization.') && !p.startsWith('membership.')),
  ),
  MEMBER: permissions.filter(
    (p) =>
      p === 'organization.read' ||
      p.startsWith('customer.') ||
      p.startsWith('notification.') ||
      [
        'invoice.read',
        'invoice.create',
        'invoice.update_draft',
        'invoice.delete_draft',
        'invoice.issue',
      ].includes(p),
  ),
  VIEWER: [
    'organization.read',
    'customer.read',
    'invoice.read',
    'expense.read',
    'analytics.read',
    'report.read',
    'report.export',
    'notification.read',
    'notification.update_self',
  ],
};
export function grants(role: string, active: boolean): readonly Permission[] {
  return active && Object.hasOwn(rolePermissions, role) ? (rolePermissions[role] ?? []) : [];
}
