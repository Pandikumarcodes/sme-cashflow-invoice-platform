import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service.js';
import {
  requireTenantResource,
  tenantWhere,
  tenantResourceWhere,
} from '../../../database/helpers/tenant-query.js';
import { InvoiceSettlement } from '../../invoices/application/invoice-settlement.js';
import { PaymentPersistence, PAYMENT_INCLUDE } from '../infrastructure/payment-persistence.js';
import {
  paymentAmount,
  assertWithinBalance,
  paymentDate,
  reversalInput,
  PAYMENT_METHODS,
} from '../domain/payment-policy.js';
import { toPaymentResponse } from '../payment-response.js';
import {
  paymentListOptions,
  paymentListFilter,
  decodePaymentCursor,
  encodePaymentCursor,
} from './payment-pagination.js';

@Injectable()
export class PaymentsService {
  constructor(prismaService, authorization, invoices, persistence, idempotency) {
    this.prismaService = prismaService;
    this.authorization = authorization;
    this.invoices = invoices;
    this.persistence = persistence;
    this.idempotency = idempotency;
  }

  async resolve(client, context, permission) {
    requireTenantContext(context);
    return resolveTenantAccess(client, context, context.organizationId, this.authorization, [
      permission,
    ]);
  }

  async transaction(context, permission, operation) {
    const prisma = await this.prismaService.getClient();
    return prisma.$transaction(
      async (tx) => {
        const { tenant, membership } = await this.resolve(tx, context, permission);
        return operation(tx, tenant, membership.organization);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 },
    );
  }

  record(context, invoiceId, input, key, metadata = {}) {
    return this.transaction(
      context,
      PERMISSIONS.PAYMENT_CREATE,
      async (tx, tenant, organization) => {
        // Scope-only read before claiming; no lifecycle/financial decision is
        // made until the invoice lock is held. Completed receipts can replay later.
        const visible = await this.invoices.find(tx, tenant, invoiceId);
        const amount = paymentAmount(input.amount, visible.currency);
        const date = paymentDate(input.paymentDate);
        if (!PAYMENT_METHODS.includes(input.method))
          throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Payment method is invalid.');
        const claim = await this.idempotency.claim(tx, tenant, 'payment.record', key, {
          invoiceId: visible.id,
          currency: visible.currency,
          amount: amount.toString(),
          paymentDate: input.paymentDate,
          method: input.method,
        });
        if (claim.replayed) return this.replay(tx, tenant, claim.record, 'PAYMENT_RECORDED');
        const invoice = await this.invoices.lock(tx, tenant, invoiceId);
        this.invoices.requireIssued(invoice);
        if (invoice.currency !== organization.baseCurrency)
          throw new ApplicationError(
            ERROR_CODES.CURRENCY_MISMATCH,
            'Invoice currency differs from organization currency.',
          );
        const active = await this.persistence.activeTotal(tx, tenant, invoice.id);
        this.invoices.verify(invoice, active);
        assertWithinBalance(invoice.total, active, amount, invoice.currency);
        const before = this.invoices.summary(invoice, organization.timezone);
        const created = await tx.payment.create({
          data: {
            organizationId: tenant.organizationId,
            invoiceId: invoice.id,
            amount,
            currency: invoice.currency,
            paymentDate: date,
            paymentMethod: input.method,
            createdByUserId: tenant.userId,
          },
        });
        const updated = await this.invoices.apply(
          tx,
          tenant,
          invoice,
          await this.persistence.activeTotal(tx, tenant, invoice.id),
        );
        const payment = await this.persistence.find(tx, tenant, created.id);
        const data = toPaymentResponse(
          payment,
          this.invoices.summary(updated, organization.timezone),
        );
        await this.audit(tx, tenant, 'PAYMENT_RECORDED', data, { invoice: before }, metadata);
        await this.event(tx, tenant, 'PAYMENT_RECORDED', payment, updated.version, metadata);
        await this.idempotency.complete(tx, tenant, claim.record, payment.id, 201);
        return { data, replayed: false, httpStatus: 201 };
      },
    );
  }

  reverse(context, paymentId, input, key, metadata = {}) {
    return this.transaction(
      context,
      PERMISSIONS.PAYMENT_REVERSE,
      async (tx, tenant, organization) => {
        const visible = await this.persistence.find(tx, tenant, paymentId);
        const reversal = reversalInput(input);
        const claim = await this.idempotency.claim(tx, tenant, 'payment.reverse', key, {
          paymentId: visible.id,
          invoiceId: visible.invoiceId,
          currency: visible.currency,
          reason: reversal.reason,
          reversalDate: input.reversalDate,
        });
        if (claim.replayed) return this.replay(tx, tenant, claim.record, 'PAYMENT_REVERSED');
        const invoice = await this.invoices.lock(tx, tenant, visible.invoiceId);
        const payment = await this.persistence.find(tx, tenant, paymentId, true);
        if (payment.status !== 'RECORDED' || payment.reversal)
          throw new ApplicationError(
            ERROR_CODES.PAYMENT_ALREADY_REVERSED,
            'Payment has already been reversed.',
          );
        this.invoices.requireIssued(invoice);
        if (payment.currency !== invoice.currency || invoice.currency !== organization.baseCurrency)
          throw new ApplicationError(
            ERROR_CODES.CURRENCY_MISMATCH,
            'Payment currency differs from invoice currency.',
          );
        const active = await this.persistence.activeTotal(tx, tenant, invoice.id);
        this.invoices.verify(invoice, active);
        const before = toPaymentResponse(
          payment,
          this.invoices.summary(invoice, organization.timezone),
        );
        await tx.paymentReversal.create({
          data: {
            organizationId: tenant.organizationId,
            paymentId: payment.id,
            amount: payment.amount,
            reason: reversal.reason,
            reversalDate: reversal.reversalDate,
            reversedByUserId: tenant.userId,
          },
        });
        await tx.payment.update({
          where: { ...tenantResourceWhere(tenant, payment.id), status: 'RECORDED' },
          data: { status: 'REVERSED', reversedAt: new Date() },
        });
        const updated = await this.invoices.apply(
          tx,
          tenant,
          invoice,
          await this.persistence.activeTotal(tx, tenant, invoice.id),
        );
        const reversed = await this.persistence.find(tx, tenant, payment.id);
        const data = toPaymentResponse(
          reversed,
          this.invoices.summary(updated, organization.timezone),
        );
        await this.audit(tx, tenant, 'PAYMENT_REVERSED', data, this.receipt(before), metadata);
        await this.event(tx, tenant, 'PAYMENT_REVERSED', reversed, updated.version, metadata);
        await this.idempotency.complete(tx, tenant, claim.record, payment.id, 200);
        return { data, replayed: false, httpStatus: 200 };
      },
    );
  }

  async get(context, paymentId) {
    const prisma = await this.prismaService.getClient();
    const { tenant, membership } = await this.resolve(prisma, context, PERMISSIONS.PAYMENT_READ);
    const payment = await this.persistence.find(prisma, tenant, paymentId);
    return toPaymentResponse(
      payment,
      this.invoices.summary(payment.invoice, membership.organization.timezone),
    );
  }

  async list(context, query = {}) {
    const prisma = await this.prismaService.getClient();
    const { tenant, membership } = await this.resolve(prisma, context, PERMISSIONS.PAYMENT_READ);
    const options = paymentListOptions(tenant.organizationId, query);
    const cursor = decodePaymentCursor(query.after, options);
    const rows = await prisma.payment.findMany({
      where: tenantWhere(tenant, paymentListFilter(options, cursor)),
      include: PAYMENT_INCLUDE,
      orderBy: [{ [options.sortBy]: options.sortOrder }, { id: options.sortOrder }],
      take: options.limit + 1,
    });
    const page = rows.slice(0, options.limit);
    const hasMore = rows.length > options.limit;
    return {
      data: page.map((row) =>
        toPaymentResponse(
          row,
          this.invoices.summary(row.invoice, membership.organization.timezone),
        ),
      ),
      meta: {
        limit: options.limit,
        hasMore,
        nextCursor: hasMore ? encodePaymentCursor(page.at(-1), options) : null,
      },
    };
  }

  // Idempotency records store references, never response blobs. Immutable
  // payment facts plus the audited financial receipt reconstruct the original
  // result even after reversal, new payments or invoice voiding.
  async replay(tx, tenant, record, action) {
    if (record.resourceType !== 'Payment' || !record.resourceId)
      throw new ApplicationError(ERROR_CODES.INTERNAL_ERROR, 'Payment receipt is unavailable.');
    const payment = await this.persistence.find(tx, tenant, record.resourceId);
    const audit = requireTenantResource(
      await tx.auditLog.findFirst({
        where: tenantWhere(tenant, {
          entityType: 'Payment',
          entityId: payment.id,
          action,
          actorUserId: tenant.userId,
        }),
      }),
      'Payment receipt',
    );
    const receipt = audit.afterData;
    if (!receipt?.payment || !receipt.invoice)
      throw new ApplicationError(ERROR_CODES.INTERNAL_ERROR, 'Payment receipt is unavailable.');
    const original = {
      ...payment,
      status: receipt.payment.status,
      updatedAt: new Date(receipt.payment.updatedAt),
      reversedAt: receipt.payment.reversedAt ? new Date(receipt.payment.reversedAt) : null,
      reversal: action === 'PAYMENT_RECORDED' ? null : payment.reversal,
    };
    return {
      data: toPaymentResponse(original, receipt.invoice),
      replayed: true,
      httpStatus: record.httpStatus,
    };
  }

  receipt(data) {
    return {
      payment: {
        id: data.id,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        updatedAt: data.updatedAt.toISOString(),
        reversedAt: data.reversedAt?.toISOString() ?? null,
        reversalId: data.reversal?.id ?? null,
      },
      invoice: data.invoice,
    };
  }

  audit(tx, tenant, action, data, beforeData, metadata) {
    return tx.auditLog.create({
      data: {
        organizationId: tenant.organizationId,
        actorType: 'USER',
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        actorSessionId: tenant.sessionId,
        source: 'API',
        outcome: 'SUCCESS',
        action,
        entityType: 'Payment',
        entityId: data.id,
        changedFields:
          action === 'PAYMENT_RECORDED'
            ? ['payment', 'invoice.amountPaid', 'invoice.balanceDue']
            : ['status', 'reversal', 'invoice.amountPaid', 'invoice.balanceDue'],
        beforeData,
        afterData: this.receipt(data),
        requestId: metadata.requestId,
        correlationId: metadata.correlationId,
      },
    });
  }

  event(tx, tenant, eventType, payment, invoiceVersion, metadata) {
    return tx.pendingEvent.create({
      data: {
        organizationId: tenant.organizationId,
        eventType,
        eventVersion: 1,
        aggregateType: 'Payment',
        aggregateId: payment.id,
        payload: {
          version: 1,
          organizationId: tenant.organizationId,
          invoiceId: payment.invoiceId,
          paymentId: payment.id,
          reversalId: payment.reversal?.id ?? null,
          invoiceVersion,
          requestId: metadata.requestId ?? null,
          correlationId: metadata.correlationId ?? null,
        },
      },
    });
  }
}
Inject(PrismaService)(PaymentsService, undefined, 0);
Inject(AuthorizationService)(PaymentsService, undefined, 1);
Inject(InvoiceSettlement)(PaymentsService, undefined, 2);
Inject(PaymentPersistence)(PaymentsService, undefined, 3);
Inject(IdempotencyService)(PaymentsService, undefined, 4);
