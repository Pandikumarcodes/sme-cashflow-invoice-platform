import { PrismaClient } from '@prisma/client';

export function assertSafeTestDatabase() {
  const urlValue = process.env.DATABASE_URL;
  if (!urlValue) {
    throw new Error('DATABASE_URL is required for database integration tests.');
  }

  const url = new URL(urlValue);
  const databaseName = url.pathname.slice(1);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (!isLocal || databaseName !== 'sme_cashflow_test') {
    throw new Error('Database integration tests may run only against local sme_cashflow_test.');
  }
}

export function createTestPrismaClient() {
  assertSafeTestDatabase();
  return new PrismaClient();
}

export async function clearDatabase(prisma) {
  assertSafeTestDatabase();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_logs", "pending_events", "idempotency_records", "report_exports",
      "reminder_deliveries", "notifications", "expenses", "expense_categories",
      "organization_invitations", "payment_reversals", "payments", "invoice_items",
      "invoices", "invoice_sequences", "customers", "refresh_tokens", "refresh_sessions",
      "memberships", "organizations", "users"
    RESTART IDENTITY CASCADE
  `);
}
