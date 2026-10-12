import { testUser } from '../../test/auth-fixtures';
import { dashboardOrg } from '../dashboard/test-fixtures';
import type { Category, Expense } from './contracts';
export const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const expenseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const instant = '2026-10-01T12:00:00.000Z';
export function categoryFixture(overrides: Partial<Category> = {}): Category {
  return {
    id: categoryId,
    organizationId: dashboardOrg.id,
    name: 'Utilities',
    description: 'Operating costs',
    systemKey: 'UTILITIES',
    status: 'ACTIVE',
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  };
}
export function expenseFixture(overrides: Partial<Expense> = {}): Expense {
  return {
    id: expenseId,
    organizationId: dashboardOrg.id,
    categoryId,
    category: { id: categoryId, name: 'Utilities', status: 'ACTIVE', systemKey: 'UTILITIES' },
    amount: '40.00',
    currency: 'USD',
    expenseDate: '2026-10-01',
    description: 'Electricity bill',
    vendorPayee: 'Local utility',
    reference: 'REF-1',
    notes: 'Paid in cash',
    status: 'ACTIVE',
    createdByUserId: testUser.id,
    voidedByUserId: null,
    voidedAt: null,
    voidReason: null,
    version: 3,
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  };
}
export function voidedFixture(): Expense {
  return expenseFixture({
    status: 'VOIDED',
    voidedAt: instant,
    voidedByUserId: testUser.id,
    voidReason: 'Duplicate expense',
    version: 4,
  });
}
