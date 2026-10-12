import { testUser } from '../../test/auth-fixtures';
import { dashboardOrg } from '../dashboard/test-fixtures';
import type { Payment } from './contracts';
export const invoiceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const paymentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const instant = '2026-10-01T12:00:00.000Z';
export function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: paymentId,
    organizationId: dashboardOrg.id,
    invoiceId,
    amount: '40.00',
    currency: 'USD',
    paymentDate: '2026-10-01',
    method: 'BANK_TRANSFER',
    status: 'RECORDED',
    createdByUserId: testUser.id,
    recordedAt: instant,
    reversedAt: null,
    createdAt: instant,
    updatedAt: instant,
    reversal: null,
    invoice: {
      id: invoiceId,
      invoiceNumber: 'INV-00001',
      status: 'ISSUED',
      paymentState: 'PARTIALLY_PAID',
      amountPaid: '40.00',
      balanceDue: '60.00',
      version: 4,
    },
    ...overrides,
  };
}
export function reversedFixture(): Payment {
  return paymentFixture({
    status: 'REVERSED',
    reversedAt: instant,
    reversal: {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      paymentId,
      amount: '40.00',
      reason: 'Duplicate receipt',
      reversalDate: '2026-10-02',
      reversedByUserId: testUser.id,
      createdAt: instant,
    },
    invoice: {
      ...paymentFixture().invoice,
      paymentState: 'UNPAID',
      amountPaid: '0.00',
      balanceDue: '100.00',
      version: 5,
    },
  });
}
export function invoiceFixture(overrides: Record<string, unknown> = {}) {
  const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  return {
    id: invoiceId,
    organizationId: dashboardOrg.id,
    customerId,
    status: 'ISSUED',
    invoiceNumber: 'INV-00001',
    sequenceValue: '1',
    numberPrefix: 'INV-',
    customer: { id: customerId, displayName: 'Customer Alpha', email: null },
    paymentState: 'UNPAID',
    isOverdue: false,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'USD',
    discount: { type: 'NONE', value: '0' },
    taxRate: '0',
    items: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
        description: 'Consulting',
        quantity: '1',
        unitPrice: '100.0000',
        lineAmount: '100.00',
        sortOrder: 0,
      },
    ],
    subtotal: '100.00',
    discountTotal: '0.00',
    taxableTotal: '100.00',
    taxTotal: '0.00',
    total: '100.00',
    amountPaid: '0.00',
    balanceDue: '100.00',
    createdByUserId: testUser.id,
    issuedByUserId: testUser.id,
    issuedAt: instant,
    cancelledAt: null,
    cancelReason: null,
    voidedAt: null,
    voidReason: null,
    version: 3,
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  };
}
