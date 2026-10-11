-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED', 'VOID');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD_EXTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RefreshSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED');

-- CreateEnum
CREATE TYPE "RefreshTokenStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExpenseCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INVOICE_DUE_SOON', 'INVOICE_OVERDUE', 'PAYMENT_RECORDED', 'REPORT_READY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('DUE_SOON', 'OVERDUE');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SUPPRESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('INVOICE_REGISTER', 'RECEIVABLES', 'PAYMENT_REGISTER', 'EXPENSE_REGISTER', 'CASH_FLOW', 'CASH_BASIS_PERFORMANCE');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'WORKER');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('API', 'WORKER', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "normalizedEmail" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "legalName" VARCHAR(200) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100),
    "baseCurrency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "locale" VARCHAR(35) NOT NULL DEFAULT 'en-IN',
    "invoicePrefix" VARCHAR(12) NOT NULL DEFAULT 'INV-',
    "invoiceNumberPadding" SMALLINT NOT NULL DEFAULT 6,
    "defaultPaymentTermsDays" SMALLINT NOT NULL DEFAULT 30,
    "currencyLockedAt" TIMESTAMPTZ(3),
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "organizationTitle" VARCHAR(100),
    "joinedAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "removedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "RefreshSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" VARCHAR(50),
    "lastUsedAt" TIMESTAMPTZ(3),
    "deviceLabel" VARCHAR(120),
    "createdIp" INET,
    "createdUserAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "RefreshTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "replacedByTokenId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerCode" VARCHAR(50),
    "displayName" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "organizationId" UUID NOT NULL,
    "nextValue" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceNumber" VARCHAR(40),
    "sequenceValue" BIGINT,
    "numberPrefix" VARCHAR(12),
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxableTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "lineAmount" DECIMAL(19,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "createdByUserId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reversals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "reversalDate" DATE NOT NULL,
    "reversedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "normalizedEmail" VARCHAR(320) NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "acceptedByUserId" UUID,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalizedName" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "systemKey" VARCHAR(50),
    "status" "ExpenseCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "expenseCategoryId" UUID NOT NULL,
    "vendorPayee" VARCHAR(200),
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(150),
    "notes" VARCHAR(1000),
    "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID NOT NULL,
    "voidedByUserId" UUID,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "relatedEntityType" VARCHAR(50),
    "relatedEntityId" UUID,
    "metadata" JSONB,
    "deduplicationKey" VARCHAR(200),
    "scheduledAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "notificationId" UUID,
    "reminderType" "ReminderType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" VARCHAR(200),
    "lastErrorCode" VARCHAR(100),
    "sentAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "organizationInvitationId" UUID,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "format" VARCHAR(10) NOT NULL DEFAULT 'CSV',
    "parameters" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "storageObjectKey" VARCHAR(512),
    "checksum" VARCHAR(128),
    "rowCount" BIGINT,
    "errorCode" VARCHAR(100),
    "expiresAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "resourceType" VARCHAR(50),
    "resourceId" UUID,
    "httpStatus" SMALLINT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "eventType" VARCHAR(100) NOT NULL,
    "eventVersion" SMALLINT NOT NULL,
    "aggregateType" VARCHAR(50) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMPTZ(3),
    "processedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pending_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" UUID,
    "actorMembershipId" UUID,
    "actorSessionId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" UUID NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "changedFields" JSONB,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "requestId" VARCHAR(100),
    "correlationId" VARCHAR(100),
    "ipAddress" INET,
    "userAgent" VARCHAR(512),
    "source" "AuditSource" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_normalizedEmail_key" ON "users"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "memberships_userId_status_organizationId_idx" ON "memberships"("userId", "status", "organizationId");

-- CreateIndex
CREATE INDEX "memberships_organizationId_status_role_id_idx" ON "memberships"("organizationId", "status", "role", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organizationId_userId_key" ON "memberships"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organizationId_id_key" ON "memberships"("organizationId", "id");

-- CreateIndex
CREATE INDEX "refresh_sessions_userId_status_expiresAt_idx" ON "refresh_sessions"("userId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_status_idx" ON "refresh_tokens"("sessionId", "status");

-- CreateIndex
CREATE INDEX "customers_organizationId_status_displayName_id_idx" ON "customers"("organizationId", "status", "displayName", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_id_key" ON "customers"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_customerCode_key" ON "customers"("organizationId", "customerCode");

-- CreateIndex
CREATE INDEX "invoices_organizationId_status_issueDate_id_idx" ON "invoices"("organizationId", "status", "issueDate", "id");

-- CreateIndex
CREATE INDEX "invoices_organizationId_dueDate_id_idx" ON "invoices"("organizationId", "dueDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_id_key" ON "invoices"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_invoiceNumber_key" ON "invoices"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_sequenceValue_key" ON "invoices"("organizationId", "sequenceValue");

-- CreateIndex
CREATE INDEX "invoice_items_organizationId_invoiceId_sortOrder_idx" ON "invoice_items"("organizationId", "invoiceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_organizationId_id_key" ON "invoice_items"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_invoiceId_sortOrder_key" ON "invoice_items"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "payments_organizationId_invoiceId_status_paymentDate_id_idx" ON "payments"("organizationId", "invoiceId", "status", "paymentDate", "id");

-- CreateIndex
CREATE INDEX "payments_organizationId_paymentDate_id_idx" ON "payments"("organizationId", "paymentDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organizationId_id_key" ON "payments"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reversals_paymentId_key" ON "payment_reversals"("paymentId");

-- CreateIndex
CREATE INDEX "payment_reversals_organizationId_reversalDate_id_idx" ON "payment_reversals"("organizationId", "reversalDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reversals_organizationId_paymentId_key" ON "payment_reversals"("organizationId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_tokenHash_key" ON "organization_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "organization_invitations_organizationId_status_idx" ON "organization_invitations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "organization_invitations_status_expiresAt_idx" ON "organization_invitations"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organizationId_id_key" ON "expense_categories"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organizationId_normalizedName_key" ON "expense_categories"("organizationId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organizationId_systemKey_key" ON "expense_categories"("organizationId", "systemKey");

-- CreateIndex
CREATE INDEX "expenses_organizationId_status_expenseDate_id_idx" ON "expenses"("organizationId", "status", "expenseDate", "id");

-- CreateIndex
CREATE INDEX "expenses_organizationId_expenseCategoryId_expenseDate_id_idx" ON "expenses"("organizationId", "expenseCategoryId", "expenseDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organizationId_id_key" ON "expenses"("organizationId", "id");

-- CreateIndex
CREATE INDEX "notifications_organizationId_recipientUserId_status_created_idx" ON "notifications"("organizationId", "recipientUserId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organizationId_recipientUserId_deduplicationK_key" ON "notifications"("organizationId", "recipientUserId", "deduplicationKey");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organizationId_id_key" ON "notifications"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_deliveries_organizationId_invoiceId_reminderType_e_key" ON "reminder_deliveries"("organizationId", "invoiceId", "reminderType", "effectiveDate", "channel");

-- CreateIndex
CREATE INDEX "report_exports_organizationId_createdAt_id_idx" ON "report_exports"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "report_exports_organizationId_status_createdAt_idx" ON "report_exports"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "report_exports_status_expiresAt_idx" ON "report_exports"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organizationId_userId_operation_key_key" ON "idempotency_records"("organizationId", "userId", "operation", "key");

-- CreateIndex
CREATE INDEX "pending_events_status_availableAt_id_idx" ON "pending_events"("status", "availableAt", "id");

-- CreateIndex
CREATE INDEX "pending_events_organizationId_aggregateType_aggregateId_idx" ON "pending_events"("organizationId", "aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_occurredAt_id_idx" ON "audit_logs"("organizationId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_occurredAt_id_idx" ON "audit_logs"("organizationId", "entityType", "entityId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_actorUserId_occurredAt_id_idx" ON "audit_logs"("organizationId", "actorUserId", "occurredAt", "id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "refresh_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "invoices"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "invoices"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organizationId_paymentId_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "payments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_expenseCategoryId_fkey" FOREIGN KEY ("organizationId", "expenseCategoryId") REFERENCES "expense_categories"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "invoices"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_organizationInvitationId_fkey" FOREIGN KEY ("organizationInvitationId") REFERENCES "organization_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_events" ADD CONSTRAINT "pending_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL-only invariants from prisma/MIGRATION-CHECKLIST.md and docs/database-design.md.
ALTER TABLE "users" ADD CONSTRAINT "users_normalized_email_lowercase_check"
  CHECK ("normalizedEmail" = lower("normalizedEmail"));

ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_next_value_positive_check"
  CHECK ("nextValue" > 0);

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_financial_values_check"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineAmount" >= 0 AND "sortOrder" >= 0);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_and_status_check"
  CHECK (
    "amount" > 0
    AND (("status" = 'RECORDED' AND "reversedAt" IS NULL)
      OR ("status" = 'REVERSED' AND "reversedAt" IS NOT NULL))
  );

ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_and_status_check"
  CHECK (
    "amount" > 0
    AND (("status" = 'ACTIVE' AND "voidedAt" IS NULL AND "voidedByUserId" IS NULL AND "voidReason" IS NULL)
      OR ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND "voidReason" IS NOT NULL))
  );

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_financial_and_lifecycle_check"
  CHECK (
    "dueDate" >= "issueDate"
    AND "discountValue" >= 0
    AND "taxRate" >= 0 AND "taxRate" <= 100
    AND "subtotal" >= 0 AND "discountTotal" >= 0 AND "discountTotal" <= "subtotal"
    AND "taxableTotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0
    AND "amountPaid" >= 0 AND "amountPaid" <= "total"
    AND "balanceDue" >= 0 AND "balanceDue" = "total" - "amountPaid"
    AND "taxableTotal" = "subtotal" - "discountTotal"
    AND "total" = "taxableTotal" + "taxTotal"
    AND (
      ("discountType" = 'NONE' AND "discountValue" = 0)
      OR ("discountType" = 'FIXED' AND "discountValue" >= 0)
      OR ("discountType" = 'PERCENTAGE' AND "discountValue" >= 0 AND "discountValue" <= 100)
    )
    AND (
      ("status" = 'DRAFT' AND "invoiceNumber" IS NULL AND "sequenceValue" IS NULL AND "numberPrefix" IS NULL AND "issuedAt" IS NULL)
      OR ("status" IN ('ISSUED', 'CANCELLED', 'VOID') AND "invoiceNumber" IS NOT NULL AND "sequenceValue" IS NOT NULL AND "sequenceValue" > 0 AND "numberPrefix" IS NOT NULL AND "issuedAt" IS NOT NULL)
    )
  );

-- Prisma creates nullable unique indexes, but the approved rules require these to be partial.
DROP INDEX "customers_organizationId_customerCode_key";
DROP INDEX "invoices_organizationId_invoiceNumber_key";
DROP INDEX "invoices_organizationId_sequenceValue_key";
DROP INDEX "notifications_organizationId_recipientUserId_deduplicationK_key";

CREATE UNIQUE INDEX "refresh_tokens_one_active_per_session_key"
  ON "refresh_tokens" ("sessionId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "memberships_one_active_owner_per_organization_key"
  ON "memberships" ("organizationId") WHERE "status" = 'ACTIVE' AND "role" = 'OWNER';
CREATE UNIQUE INDEX "organization_invitations_pending_email_per_organization_key"
  ON "organization_invitations" ("organizationId", "normalizedEmail") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "customers_customer_code_per_organization_key"
  ON "customers" ("organizationId", "customerCode") WHERE "customerCode" IS NOT NULL;
CREATE UNIQUE INDEX "invoices_issued_number_per_organization_key"
  ON "invoices" ("organizationId", "invoiceNumber") WHERE "status" IN ('ISSUED', 'CANCELLED', 'VOID');
CREATE UNIQUE INDEX "invoices_issued_sequence_per_organization_key"
  ON "invoices" ("organizationId", "sequenceValue") WHERE "status" IN ('ISSUED', 'CANCELLED', 'VOID');
CREATE UNIQUE INDEX "notifications_deduplication_per_recipient_key"
  ON "notifications" ("organizationId", "recipientUserId", "deduplicationKey") WHERE "deduplicationKey" IS NOT NULL;

ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Historical actors remain attributable: deleting a referenced user is forbidden.
ALTER TABLE "customers" ADD CONSTRAINT "customers_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversedByUserId_fkey"
  FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voidedByUserId_fkey"
  FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
