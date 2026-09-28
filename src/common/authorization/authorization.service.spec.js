import { AuthorizationService } from './authorization.service.js';
import { ALL_PERMISSIONS, PERMISSIONS } from './permissions.js';

const expectedPermissions = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS.filter(
    (permission) =>
      ![PERMISSIONS.ORGANIZATION_CLOSE, PERMISSIONS.ORGANIZATION_TRANSFER_OWNERSHIP].includes(
        permission,
      ),
  ),
  ACCOUNTANT: [
    'organization.read',
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
    'audit.read',
    'notification.read',
    'notification.update_self',
  ],
  MEMBER: [
    'organization.read',
    'customer.read',
    'customer.create',
    'customer.update',
    'customer.archive',
    'invoice.read',
    'invoice.create',
    'invoice.update_draft',
    'invoice.delete_draft',
    'invoice.issue',
    'notification.read',
    'notification.update_self',
  ],
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

describe('AuthorizationService', () => {
  const authorization = new AuthorizationService();

  it.each(Object.entries(expectedPermissions))(
    'matches every canonical permission for %s',
    (role, allowed) => {
      for (const permission of ALL_PERMISSIONS) {
        expect(authorization.can(role, permission)).toBe(allowed.includes(permission));
      }
    },
  );

  it('requires all declared permissions and fails closed for unknown roles or permissions', () => {
    expect(
      authorization.canAll('ADMIN', [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.MEMBERSHIP_READ]),
    ).toBe(true);
    expect(authorization.canAll('ADMIN', [PERMISSIONS.ORGANIZATION_CLOSE])).toBe(false);
    expect(authorization.can('UNKNOWN', PERMISSIONS.ORGANIZATION_READ)).toBe(false);
    expect(authorization.can('OWNER', 'unknown.permission')).toBe(false);
    expect(() => authorization.assertPermission('VIEWER', PERMISSIONS.ORGANIZATION_UPDATE)).toThrow(
      'Permission is not granted.',
    );
  });
});
