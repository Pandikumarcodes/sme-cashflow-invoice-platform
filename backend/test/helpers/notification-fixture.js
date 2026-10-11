import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../src/common/authorization/permissions.js';
import { resolveTenantAccess } from '../../src/common/tenancy/tenant-context.js';
import { OrganizationsService } from '../../src/modules/organizations/application/organizations.service.js';
import { OrganizationInvoiceSettings } from '../../src/modules/organizations/application/organization-invoice-settings.js';
import { CustomersService } from '../../src/modules/customers/application/customers.service.js';
import { CustomerInvoiceReader } from '../../src/modules/customers/application/customer-invoice-reader.js';
import { InvoicesService } from '../../src/modules/invoices/application/invoices.service.js';
import { InvoiceSettlement } from '../../src/modules/invoices/application/invoice-settlement.js';
import { InvoiceReminderReader } from '../../src/modules/invoices/application/invoice-reminder-reader.js';
import { PaymentsService } from '../../src/modules/payments/application/payments.service.js';
import { PaymentPersistence } from '../../src/modules/payments/infrastructure/payment-persistence.js';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service.js';
import { NotificationsService } from '../../src/modules/notifications/application/notifications.service.js';
import { RemindersService } from '../../src/modules/notifications/application/reminders.service.js';

export const REMINDER_NOW = new Date('2026-01-31T20:00:00Z');
export const REMINDER_POLICY = {
  enabled: true,
  daysBeforeDue: 3,
  overdueCadenceDays: 7,
  emailProvider: 'disabled',
  workerConcurrency: 2,
};
export async function notificationFixture(prisma, name, options = {}) {
  const authorization = new AuthorizationService();
  const provider = { getClient: async () => prisma };
  const policy = { ...REMINDER_POLICY, ...options.policy };
  const config = { getOrThrow: () => policy };
  const email = options.email ?? {
    send: async () => ({ outcome: 'SENT', providerMessageId: 'capture-test' }),
  };
  const user = await prisma.user.create({
    data: {
      email: name + '@example.com',
      normalizedEmail: name + '@example.com',
      passwordHash: 'test-only',
      firstName: name,
      lastName: 'Owner',
    },
  });
  const identity = { userId: user.id, sessionId: randomUUID() };
  const org = await new OrganizationsService(provider, authorization).create(identity, {
    legalName: name,
    baseCurrency: 'INR',
    timezone: options.timezone ?? 'Asia/Kolkata',
  });
  const { tenant } = await resolveTenantAccess(prisma, identity, org.id, authorization, [
    PERMISSIONS.NOTIFICATION_READ,
  ]);
  const customer = await new CustomersService(provider, authorization).create(tenant, {
    displayName: name,
    email: 'customer@example.com',
  });
  const invoices = new InvoicesService(
    provider,
    authorization,
    new CustomerInvoiceReader(),
    new OrganizationInvoiceSettings(),
  );
  const draft = await invoices.create(tenant, {
    customerId: customer.id,
    issueDate: '2026-01-01',
    dueDate: options.dueDate ?? '2026-01-31',
    discount: { type: 'NONE', value: '0' },
    taxRate: '0',
    items: [{ description: 'Work', quantity: '1', unitPrice: '1000', sortOrder: 0 }],
  });
  const invoice = await invoices.issue(tenant, draft.id, 1);
  const payments = new PaymentsService(
    provider,
    authorization,
    new InvoiceSettlement(),
    new PaymentPersistence(),
    new IdempotencyService(),
  );
  const reminders = new RemindersService(
    provider,
    authorization,
    new InvoiceReminderReader(),
    email,
    config,
    options.clock ?? (() => REMINDER_NOW),
  );
  return {
    user,
    tenant,
    org,
    invoice,
    customer,
    invoices,
    payments,
    reminders,
    provider,
    authorization,
    config,
    notifications: new NotificationsService(provider, authorization),
  };
}
export async function reminderEvents(prisma, fixture) {
  return prisma.pendingEvent.findMany({
    where: { organizationId: fixture.org.id, eventType: 'REMINDER_DELIVERY_REQUESTED' },
    orderBy: { id: 'asc' },
  });
}
export const eventJob = (event) => ({
  version: 1,
  organizationId: event.organizationId,
  eventId: event.id,
});
export async function deliverReminders(prisma, fixture) {
  for (const event of await reminderEvents(prisma, fixture))
    await fixture.reminders.handleEvent(eventJob(event), event.payload.channel);
}
