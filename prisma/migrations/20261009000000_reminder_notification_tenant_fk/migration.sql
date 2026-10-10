-- Notification delivery links must stay within their organization. PostgreSQL 16
-- supports nulling only the optional link, preserving the required tenant scope.
BEGIN;
ALTER TABLE "reminder_deliveries"
  DROP CONSTRAINT "reminder_deliveries_notificationId_fkey";
ALTER TABLE "reminder_deliveries"
  ADD CONSTRAINT "reminder_deliveries_organizationId_notificationId_fkey"
  FOREIGN KEY ("organizationId", "notificationId")
  REFERENCES "notifications" ("organizationId", "id")
  ON DELETE SET NULL ("notificationId") ON UPDATE CASCADE;
COMMIT;
