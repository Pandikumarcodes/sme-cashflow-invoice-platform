# First migration checklist

Prisma cannot express the required PostgreSQL partial indexes and CHECK constraints below. Prompt 6B must add and inspect these in the generated initial migration SQL before applying it:

- lower-case `users.normalized_email`; positive invoice sequence, quantity, payment, and expense amounts; non-negative invoice totals/line amounts; 0–100 percentage rates; `due_date >= issue_date`; invoice balance cache arithmetic.
- status-aligned timestamps and lifecycle evidence; issued invoice conditional number/snapshot fields.
- partial unique indexes for active refresh token/session, active owner, pending invitation, optional customer code, issued invoice numbers/sequence values, and notification deduplication keys.
- tenant composite foreign keys for invoice/customer, invoice item/invoice, payment/invoice, payment reversal/payment, expense/category, and reminder/invoice; notification/reminder link uses `SET NULL` on notification retention deletion.
- restrictive user historical-reference foreign keys and append-only audit database grants.

Prompt 20 correction: the initial reminder/notification FK used notificationId only.
The reviewed 20261009000000_reminder_notification_tenant_fk migration makes the link
tenant-composite and uses PostgreSQL column-specific SET NULL(notificationId), keeping
organizationId required. The FK replacement is transactional and must fail safely if
pre-existing foreign-tenant links need review. Do not replace it with Prisma's default
composite SET NULL on both columns in a generated migration.
