-- Reviewed Prompt 14 correction: the initial model cannot freeze the existing
-- Customer name/email or retain the documented issuer/cancel/void evidence.
-- No invented backfill: deployments with finalized legacy rows must supply
-- reviewed historical evidence before applying this migration.
BEGIN;
ALTER TABLE "invoices"
  ADD COLUMN "issuedByUserId" UUID,
  ADD COLUMN "billToName" VARCHAR(200),
  ADD COLUMN "billToEmail" VARCHAR(320),
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelReason" VARCHAR(500),
  ADD COLUMN "voidedAt" TIMESTAMPTZ(3),
  ADD COLUMN "voidReason" VARCHAR(500);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_evidence_check" CHECK (
  (("status" = 'DRAFT' AND "issuedByUserId" IS NULL AND "billToName" IS NULL AND "billToEmail" IS NULL)
    OR ("status" <> 'DRAFT' AND "issuedByUserId" IS NOT NULL AND "billToName" IS NOT NULL
      AND length(btrim("billToName")) > 0 AND "total" > 0))
  AND (("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL
      AND length(btrim("cancelReason")) > 0)
    OR ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelReason" IS NULL))
  AND (("status" = 'VOID' AND "voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL
      AND length(btrim("voidReason")) > 0)
    OR ("status" <> 'VOID' AND "voidedAt" IS NULL AND "voidReason" IS NULL))
);
COMMIT;
