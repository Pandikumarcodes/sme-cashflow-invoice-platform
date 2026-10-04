import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { tenantResourceWhere, tenantWhere } from '../../../database/helpers/tenant-query.js';
import { CustomerInvoiceReader } from '../../customers/application/customer-invoice-reader.js';
import { OrganizationInvoiceSettings } from '../../organizations/application/organization-invoice-settings.js';
import { calculateInvoice } from '../domain/invoice-calculator.js';
import { assertDraft, invoiceDates } from '../domain/invoice-policy.js';
import { toInvoiceResponse } from '../invoice-response.js';
import { InvoicePersistence, INVOICE_INCLUDE } from '../infrastructure/invoice-persistence.js';
import {
  invoiceListOptions,
  invoiceListFilter,
  decodeInvoiceCursor,
  encodeInvoiceCursor,
} from './invoice-pagination.js';

const FIELDS = ['customerId', 'issueDate', 'dueDate', 'discount', 'taxRate', 'items'];

@Injectable()
export class InvoicesService {
  constructor(
    prismaService,
    authorization,
    customers,
    settings,
    persistence = new InvoicePersistence(),
  ) {
    this.prismaService = prismaService;
    this.authorization = authorization;
    this.customers = customers;
    this.settings = settings;
    this.persistence = persistence;
  }

  async resolve(client, context, permission) {
    requireTenantContext(context);
    return resolveTenantAccess(client, context, context.organizationId, this.authorization, [
      permission,
    ]);
  }

  async transaction(context, permission, operation) {
    const prisma = await this.prismaService.getClient();
    try {
      return await prisma.$transaction(
        async (tx) => {
          const { tenant, membership } = await this.resolve(tx, context, permission);
          return operation(tx, tenant, membership.organization);
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error?.code === 'P2002')
        throw new ApplicationError(
          ERROR_CODES.DUPLICATE_INVOICE_NUMBER,
          'Invoice identity conflicts with an existing document.',
        );
      throw error;
    }
  }

  find(client, tenant, id, lock = false) {
    return this.persistence.find(client, tenant, id, lock);
  }

  async create(context, input, metadata = {}) {
    return this.transaction(context, PERMISSIONS.INVOICE_CREATE, async (tx, tenant) => {
      const organization = await this.settings.lock(tx, tenant, true);
      await this.customers.active(tx, tenant, input.customerId);
      const dates = invoiceDates(input.issueDate, input.dueDate);
      const calculated = calculateInvoice(input, organization.baseCurrency);
      const invoice = await tx.invoice.create({
        data: {
          organizationId: tenant.organizationId,
          customerId: input.customerId,
          currency: organization.baseCurrency,
          createdByUserId: tenant.userId,
          ...dates,
          ...calculated.values,
        },
      });
      await this.insertItems(tx, tenant, invoice.id, calculated.items);
      const response = toInvoiceResponse(
        await this.find(tx, tenant, invoice.id),
        organization.timezone,
      );
      await this.audit(tx, tenant, 'INVOICE_CREATED', response, null, FIELDS, metadata);
      return response;
    });
  }

  async get(context, id) {
    const prisma = await this.prismaService.getClient();
    const { tenant, membership } = await this.resolve(prisma, context, PERMISSIONS.INVOICE_READ);
    return toInvoiceResponse(await this.find(prisma, tenant, id), membership.organization.timezone);
  }

  async list(context, query = {}) {
    const prisma = await this.prismaService.getClient();
    const { tenant, membership } = await this.resolve(prisma, context, PERMISSIONS.INVOICE_READ);
    const options = invoiceListOptions(
      tenant.organizationId,
      query,
      membership.organization.timezone,
    );
    const key = decodeInvoiceCursor(query.after, options);
    const rows = await prisma.invoice.findMany({
      where: tenantWhere(tenant, invoiceListFilter(options, key)),
      include: INVOICE_INCLUDE,
      orderBy: [
        {
          [options.sortBy]:
            options.sortBy === 'invoiceNumber'
              ? { sort: options.sortOrder, nulls: 'last' }
              : options.sortOrder,
        },
        { id: options.sortOrder },
      ],
      take: options.limit + 1,
    });
    const page = rows.slice(0, options.limit);
    const hasMore = rows.length > options.limit;
    return {
      data: page.map((row) => toInvoiceResponse(row, membership.organization.timezone)),
      meta: {
        limit: options.limit,
        nextCursor: hasMore ? encodeInvoiceCursor(page.at(-1), options) : null,
        hasMore,
      },
    };
  }

  async update(context, id, version, input, metadata = {}) {
    const changed = FIELDS.filter((field) => input[field] !== undefined);
    if (!changed.length)
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'At least one draft field is required.',
      );
    return this.transaction(
      context,
      PERMISSIONS.INVOICE_UPDATE_DRAFT,
      async (tx, tenant, organization) => {
        const before = await this.find(tx, tenant, id, true);
        assertDraft(before, version);
        const customerId = input.customerId ?? before.customerId;
        await this.customers.active(tx, tenant, customerId);
        const dates = invoiceDates(
          input.issueDate ?? before.issueDate.toISOString().slice(0, 10),
          input.dueDate ?? before.dueDate.toISOString().slice(0, 10),
        );
        const calculated = calculateInvoice(this.calculationInput(before, input), before.currency);
        await tx.invoice.update({
          where: tenantResourceWhere(tenant, id),
          data: { customerId, ...dates, ...calculated.values, version: { increment: 1 } },
        });
        if (input.items !== undefined) await this.replaceItems(tx, tenant, id, calculated.items);
        else await this.updateLineAmounts(tx, tenant, before.items, calculated.items);
        const response = toInvoiceResponse(await this.find(tx, tenant, id), organization.timezone);
        await this.audit(
          tx,
          tenant,
          'INVOICE_UPDATED',
          response,
          toInvoiceResponse(before, organization.timezone),
          changed,
          metadata,
        );
        return response;
      },
    );
  }

  async issue(context, id, version, metadata = {}) {
    return this.transaction(context, PERMISSIONS.INVOICE_ISSUE, async (tx, tenant) => {
      const before = await this.find(tx, tenant, id, true);
      assertDraft(before, version, true);
      const organization = await this.settings.lock(tx, tenant);
      const customer = await this.customers.active(tx, tenant, before.customerId);
      invoiceDates(
        before.issueDate.toISOString().slice(0, 10),
        before.dueDate.toISOString().slice(0, 10),
      );
      const calculated = calculateInvoice(this.calculationInput(before), before.currency);
      if (calculated.values.total.lte('0'))
        throw new ApplicationError(
          ERROR_CODES.INVALID_MONEY,
          'Invoice total must be positive to issue.',
        );
      const numbering = await this.persistence.allocate(tx, tenant, organization);
      await tx.invoice.update({
        where: tenantResourceWhere(tenant, id),
        data: {
          ...calculated.values,
          status: 'ISSUED',
          ...numbering,
          billToName: customer.displayName,
          billToEmail: customer.email,
          issuedByUserId: tenant.userId,
          issuedAt: new Date(),
          version: { increment: 1 },
        },
      });
      // Recalculate existing lines without changing their identities.
      await this.updateLineAmounts(tx, tenant, before.items, calculated.items);
      const response = toInvoiceResponse(await this.find(tx, tenant, id), organization.timezone);
      await this.audit(
        tx,
        tenant,
        'INVOICE_ISSUED',
        response,
        toInvoiceResponse(before, organization.timezone),
        ['status', 'invoiceNumber', 'issuedAt', 'customer'],
        metadata,
      );
      await tx.pendingEvent.create({
        data: {
          organizationId: tenant.organizationId,
          eventType: 'INVOICE_ISSUED',
          eventVersion: 1,
          aggregateType: 'Invoice',
          aggregateId: id,
          payload: {
            version: 1,
            organizationId: tenant.organizationId,
            invoiceId: id,
            invoiceVersion: response.version,
            requestId: metadata.requestId ?? null,
            correlationId: metadata.correlationId ?? null,
          },
        },
      });
      return response;
    });
  }

  async deleteDraft(context, id, version, metadata = {}) {
    return this.transaction(
      context,
      PERMISSIONS.INVOICE_DELETE_DRAFT,
      async (tx, tenant, organization) => {
        const before = await this.find(tx, tenant, id, true);
        assertDraft(before, version);
        await tx.invoiceItem.deleteMany({ where: tenantWhere(tenant, { invoiceId: id }) });
        await tx.invoice.delete({ where: tenantResourceWhere(tenant, id) });
        await this.audit(
          tx,
          tenant,
          'INVOICE_DELETED',
          { id },
          toInvoiceResponse(before, organization.timezone),
          ['status'],
          metadata,
        );
      },
    );
  }

  async endLifecycle(context, id, status, reason, metadata = {}) {
    if (
      !['CANCELLED', 'VOID'].includes(status) ||
      typeof reason !== 'string' ||
      !/\S/.test(reason) ||
      reason.length > 500
    )
      throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Invalid lifecycle command.');
    const permission =
      status === 'CANCELLED' ? PERMISSIONS.INVOICE_CANCEL : PERMISSIONS.INVOICE_VOID;
    return this.transaction(context, permission, async (tx, tenant, organization) => {
      const before = await this.find(tx, tenant, id, true);
      if (before.status !== 'ISSUED')
        throw new ApplicationError(ERROR_CODES.INVALID_INVOICE_STATE, 'Invoice must be issued.');
      // Read-only precondition: no payment workflow is introduced here. Future
      // payment/reversal writers must acquire the same invoice lock first.
      const payments = await tx.payment.count({
        where: tenantWhere(tenant, {
          invoiceId: id,
          ...(status === 'VOID' ? { status: 'RECORDED' } : {}),
        }),
      });
      if (payments)
        throw new ApplicationError(
          ERROR_CODES.ACTIVE_PAYMENTS_EXIST,
          'Payment history prevents this invoice transition.',
        );
      await tx.invoice.update({
        where: tenantResourceWhere(tenant, id),
        data: {
          status,
          version: { increment: 1 },
          ...(status === 'CANCELLED'
            ? { cancelledAt: new Date(), cancelReason: reason.trim() }
            : { voidedAt: new Date(), voidReason: reason.trim() }),
        },
      });
      const response = toInvoiceResponse(await this.find(tx, tenant, id), organization.timezone);
      await this.audit(
        tx,
        tenant,
        status === 'VOID' ? 'INVOICE_VOIDED' : 'INVOICE_CANCELLED',
        response,
        toInvoiceResponse(before, organization.timezone),
        ['status'],
        metadata,
      );
      return response;
    });
  }

  calculationInput(invoice, input = {}) {
    return {
      discount: input.discount ?? {
        type: invoice.discountType,
        value: invoice.discountValue.toString(),
      },
      taxRate: input.taxRate ?? invoice.taxRate.toString(),
      items:
        input.items ??
        invoice.items.map((item) => ({
          description: item.description,
          sortOrder: item.sortOrder,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
        })),
    };
  }

  insertItems(tx, tenant, id, items) {
    return tx.invoiceItem.createMany({
      data: items.map((item) => ({
        ...item,
        organizationId: tenant.organizationId,
        invoiceId: id,
      })),
    });
  }

  async replaceItems(tx, tenant, id, items) {
    await tx.invoiceItem.deleteMany({ where: tenantWhere(tenant, { invoiceId: id }) });
    await this.insertItems(tx, tenant, id, items);
  }

  async updateLineAmounts(tx, tenant, items, calculatedItems) {
    const amounts = new Map(calculatedItems.map((item) => [item.sortOrder, item.lineAmount]));
    for (const item of items) {
      await tx.invoiceItem.update({
        where: tenantResourceWhere(tenant, item.id),
        data: { lineAmount: amounts.get(item.sortOrder) },
      });
    }
  }

  audit(tx, tenant, action, after, before, changedFields, metadata) {
    const snapshot = (value) =>
      value?.status
        ? {
            status: value.status,
            invoiceNumber: value.invoiceNumber,
            customerId: value.customerId,
            total: value.total,
            discount: value.discount,
            taxRate: value.taxRate,
            version: value.version,
            cancelReason: value.cancelReason,
            voidReason: value.voidReason,
            issueDate: value.issueDate,
            dueDate: value.dueDate,
            currency: value.currency,
            subtotal: value.subtotal,
            discountTotal: value.discountTotal,
            taxableTotal: value.taxableTotal,
            taxTotal: value.taxTotal,
            amountPaid: value.amountPaid,
            balanceDue: value.balanceDue,
            issuedAt: value.issuedAt?.toISOString() ?? null,
            items: value.items.map(({ id, quantity, unitPrice, lineAmount, sortOrder }) => ({
              id,
              quantity,
              unitPrice,
              lineAmount,
              sortOrder,
            })),
          }
        : null;
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
        entityType: 'Invoice',
        entityId: after.id,
        changedFields,
        beforeData: snapshot(before),
        afterData: snapshot(after),
        requestId: metadata.requestId,
        correlationId: metadata.correlationId,
      },
    });
  }
}
Inject(PrismaService)(InvoicesService, undefined, 0);
Inject(AuthorizationService)(InvoicesService, undefined, 1);
Inject(CustomerInvoiceReader)(InvoicesService, undefined, 2);
Inject(OrganizationInvoiceSettings)(InvoicesService, undefined, 3);
Inject(InvoicePersistence)(InvoicesService, undefined, 4);
