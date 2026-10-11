import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import { moneyString } from '../../../common/money/decimal.js';
import { CashFlowReader } from './cash-flow-reader.js';
import { ProfitLossReader } from './profit-loss-reader.js';
import { AnalyticsReader, invoiceFacts } from './analytics-reader.js';
import { validateAnalyticsFacts } from '../domain/analytics.js';

@Injectable()
export class ReportReader {
  constructor(cash, performance, analytics) {
    this.cash = cash;
    this.performance = performance;
    this.analytics = analytics;
  }
  async read(tx, tenant, type, options, organization, take = 10001, after = null) {
    requireTenantContext(tenant);
    const currency = organization.baseCurrency;
    if (type === 'RECEIVABLES') {
      const result = await this.analytics.aging(tx, tenant, options, organization);
      const start = after ? result.data.buckets.findIndex((row) => row.bucket === after) + 1 : 0;
      return result.data.buckets
        .slice(start, start + take)
        .map((row) => ({ ...row, currency, asOfDate: options.asOfDate }));
    }
    if (type === 'CASH_FLOW') {
      const result = await this.cash.read(tx, tenant, options, organization);
      return [
        { kind: 'TOTAL', currency, ...result.data },
        ...result.data.series.map((row) => ({ kind: 'PERIOD', currency, ...row })),
      ];
    }
    if (type === 'CASH_BASIS_PERFORMANCE') {
      const result = await this.performance.read(tx, tenant, options, organization);
      return [
        { kind: 'TOTAL', currency, ...result.data },
        ...(result.data.series ?? []).map((row) => ({ kind: 'PERIOD', currency, ...row })),
        ...result.data.expenseByCategory.map((row) => ({
          kind: 'CATEGORY',
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          expenses: row.amount,
          currency,
        })),
      ];
    }
    const idFilter = after ? Prisma.sql`AND r.id > ${after}::uuid` : Prisma.empty;
    let rows;
    if (type === 'INVOICE_REGISTER') {
      rows = await tx.$queryRaw`${invoiceFacts(tenant, options, organization)}
        SELECT r.id, r.status, r."issueDate", r."dueDate", r.total, r.paid, r.balance,
          r.mismatch AS "currencyMismatch", r.invalid AS "invalidSettlement",
          i."invoiceNumber", i."customerId", COALESCE(i."billToName", c."displayName") AS "customerName"
        FROM facts r JOIN invoices i ON i.id = r.id AND i."organizationId" = ${tenant.organizationId}::uuid
        JOIN customers c ON c.id = i."customerId" AND c."organizationId" = i."organizationId"
        WHERE r."issueDate" BETWEEN ${options.fromDate}::date AND ${options.toDate}::date
        ${options.status ? Prisma.sql`AND r.status::text = ${options.status}` : Prisma.empty}
        ${options.customerId ? Prisma.sql`AND i."customerId" = ${options.customerId}::uuid` : Prisma.empty}
        ${idFilter} ORDER BY r.id LIMIT ${take}`;
    } else if (type === 'PAYMENT_REGISTER') {
      rows =
        await tx.$queryRaw`SELECT r.id, r."invoiceId", i."invoiceNumber", c."displayName" AS "customerName", r."paymentDate", r."paymentMethod", r.currency, r.amount
        FROM payments r JOIN invoices i ON i.id = r."invoiceId" AND i."organizationId" = r."organizationId"
        JOIN customers c ON c.id = i."customerId" AND c."organizationId" = i."organizationId"
        WHERE r."organizationId" = ${tenant.organizationId}::uuid AND r.status = 'RECORDED'
        AND r."paymentDate" BETWEEN ${options.fromDate}::date AND ${options.toDate}::date
        ${options.invoiceId ? Prisma.sql`AND r."invoiceId" = ${options.invoiceId}::uuid` : Prisma.empty}
        ${idFilter} ORDER BY r.id LIMIT ${take}`;
    } else {
      rows =
        await tx.$queryRaw`SELECT r.id, r."expenseDate", c.id AS "categoryId", c.name AS "categoryName", r."vendorPayee", r.description, r.currency, r.amount
        FROM expenses r JOIN expense_categories c ON c.id = r."expenseCategoryId" AND c."organizationId" = r."organizationId"
        WHERE r."organizationId" = ${tenant.organizationId}::uuid AND r.status = 'ACTIVE'
        AND r."expenseDate" BETWEEN ${options.fromDate}::date AND ${options.toDate}::date
        ${options.expenseCategoryId ? Prisma.sql`AND r."expenseCategoryId" = ${options.expenseCategoryId}::uuid` : Prisma.empty}
        ${options.vendorPayee ? Prisma.sql`AND r."vendorPayee" = ${options.vendorPayee}` : Prisma.empty}
        ${idFilter} ORDER BY r.id LIMIT ${take}`;
    }
    return rows.map((row) => {
      validateAnalyticsFacts({
        ...row,
        currencyMismatch:
          row.currencyMismatch || (row.currency !== undefined && row.currency !== currency),
      });
      const result = { ...row, currency };
      delete result.currencyMismatch;
      delete result.invalidSettlement;
      for (const field of ['issueDate', 'dueDate', 'paymentDate', 'expenseDate'])
        if (row[field]) result[field] = row[field].toISOString().slice(0, 10);
      for (const field of ['total', 'paid', 'balance', 'amount'])
        if (row[field] !== undefined) result[field] = moneyString(row[field], currency);
      if (type === 'INVOICE_REGISTER')
        result.overdue =
          row.status === 'ISSUED' && row.balance.gt(0) && result.dueDate < options.asOfDate;
      return result;
    });
  }
}
Inject(CashFlowReader)(ReportReader, undefined, 0);
Inject(ProfitLossReader)(ReportReader, undefined, 1);
Inject(AnalyticsReader)(ReportReader, undefined, 2);
