import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import { tenantWhere } from '../../../database/helpers/tenant-query.js';
import { agingResponse, analyticsSummaryResponse } from '../domain/analytics.js';
import { CashFlowReader } from './cash-flow-reader.js';

// This CTE is shared by summary and aging. Every source and join is tenant-bound;
// balances come from authoritative receipt rows, not mutable invoice caches.
export function invoiceFacts(tenant, options, organization) {
  requireTenantContext(tenant);
  return Prisma.sql`WITH paid AS (
    SELECT "invoiceId", SUM(amount) AS paid, MAX("paymentDate") AS "finalDate",
      bool_or(currency <> ${organization.baseCurrency}) AS mismatch
    FROM payments WHERE "organizationId" = ${tenant.organizationId}::uuid
      AND status = 'RECORDED' AND "paymentDate" <= ${options.asOfDate}::date
    GROUP BY "invoiceId"
  ), facts AS (
    SELECT i.id, i.status, i."issueDate", i."dueDate", i.total,
      COALESCE(p.paid, 0::numeric) AS paid, p."finalDate",
      i.total - COALESCE(p.paid, 0::numeric) AS balance,
      (i.currency <> ${organization.baseCurrency} OR COALESCE(p.mismatch, false)) AS mismatch,
      (COALESCE(p.paid, 0::numeric) < 0 OR COALESCE(p.paid, 0::numeric) > i.total) AS invalid
    FROM invoices i LEFT JOIN paid p ON p."invoiceId" = i.id
    WHERE i."organizationId" = ${tenant.organizationId}::uuid
  )`;
}
@Injectable()
export class AnalyticsReader {
  constructor(cashFlow) {
    this.cashFlow = cashFlow;
  }
  async summary(tx, tenant, options, organization) {
    const cash = await this.cashFlow.read(
      tx,
      tenant,
      { fromDate: options.fromDate, toDate: options.toDate, groupBy: 'month' },
      organization,
    );
    const cohort = Prisma.sql`"issueDate" BETWEEN ${options.fromDate}::date AND ${options.toDate}::date`;
    const [row] = await tx.$queryRaw`${invoiceFacts(tenant, options, organization)}
      SELECT
        COALESCE(SUM(total) FILTER (WHERE status = 'ISSUED' AND ${cohort}), 0) AS "totalInvoiced",
        COUNT(*) FILTER (WHERE status = 'DRAFT' AND ${cohort})::int AS "draftCount",
        COUNT(*) FILTER (WHERE status = 'ISSUED' AND ${cohort})::int AS "issuedCount",
        COUNT(*) FILTER (WHERE status = 'CANCELLED' AND ${cohort})::int AS "cancelledCount",
        COUNT(*) FILTER (WHERE status = 'VOID' AND ${cohort})::int AS "voidCount",
        COALESCE(SUM(paid) FILTER (WHERE status = 'ISSUED' AND ${cohort}), 0) AS "cohortCollected",
        COALESCE(SUM("finalDate" - "dueDate") FILTER (WHERE status = 'ISSUED' AND ${cohort} AND total > 0 AND paid = total), 0)::numeric AS "delayDays",
        COUNT(*) FILTER (WHERE status = 'ISSUED' AND ${cohort} AND total > 0 AND paid = total)::int AS "sampleSize",
        COALESCE(SUM(balance) FILTER (WHERE status = 'ISSUED' AND "issueDate" <= ${options.asOfDate}::date AND balance > 0), 0) AS outstanding,
        COALESCE(SUM(balance) FILTER (WHERE status = 'ISSUED' AND "issueDate" <= ${options.asOfDate}::date AND balance > 0 AND "dueDate" < ${options.asOfDate}::date), 0) AS overdue,
        COALESCE(bool_or(mismatch) FILTER (WHERE status = 'ISSUED' AND (${cohort} OR "issueDate" <= ${options.asOfDate}::date)), false) AS "currencyMismatch",
        COALESCE(bool_or(invalid) FILTER (WHERE status = 'ISSUED' AND (${cohort} OR "issueDate" <= ${options.asOfDate}::date)), false) AS "invalidSettlement"
      FROM facts`;
    const activeCount = await tx.customer.count({
      where: tenantWhere(tenant, { status: 'ACTIVE' }),
    });
    return analyticsSummaryResponse(row, cash, activeCount, options, organization);
  }
  async aging(tx, tenant, options, organization) {
    const rows = await tx.$queryRaw`${invoiceFacts(tenant, options, organization)}
      , aged AS (
        SELECT *, CASE WHEN ${options.asOfDate}::date - "dueDate" <= 0 THEN 'CURRENT'
          WHEN ${options.asOfDate}::date - "dueDate" <= 30 THEN '1_30'
          WHEN ${options.asOfDate}::date - "dueDate" <= 60 THEN '31_60'
          WHEN ${options.asOfDate}::date - "dueDate" <= 90 THEN '61_90'
          ELSE '91_PLUS' END AS bucket
        FROM facts WHERE status = 'ISSUED' AND "issueDate" <= ${options.asOfDate}::date
      )
      SELECT bucket, COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) AS amount,
        COUNT(*) FILTER (WHERE balance > 0)::int AS "invoiceCount",
        bool_or(mismatch) AS "currencyMismatch", bool_or(invalid) AS "invalidSettlement"
      FROM aged GROUP BY bucket`;
    return agingResponse(rows, options, organization);
  }
}
Inject(CashFlowReader)(AnalyticsReader, undefined, 0);
