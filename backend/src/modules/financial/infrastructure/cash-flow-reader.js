import { Injectable } from '@nestjs/common';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import { cashFlowResponse } from '../domain/cash-flow.js';

// Narrow exported read contract: the caller owns the transaction and trusted
// tenant resolution. Business dates are DATE columns, not UTC instants.
@Injectable()
export class CashFlowReader {
  async read(tx, tenant, options, organization) {
    requireTenantContext(tenant);
    const { fromDate, toDate, groupBy } = options;
    const currency = organization.baseCurrency;
    const rows = await tx.$queryRaw`
      WITH flows AS (
        SELECT date_trunc(${groupBy}::text, "paymentDate"::timestamp)::date AS "periodStart",
          SUM(amount) AS inflows, 0::numeric AS outflows,
          bool_or(currency <> ${currency}) AS mismatch
        FROM payments
        WHERE "organizationId" = ${tenant.organizationId}::uuid AND status = 'RECORDED'
          AND "paymentDate" >= ${fromDate}::date AND "paymentDate" <= ${toDate}::date
        GROUP BY 1
        UNION ALL
        SELECT date_trunc(${groupBy}::text, "expenseDate"::timestamp)::date,
          0::numeric, SUM(amount), bool_or(currency <> ${currency})
        FROM expenses
        WHERE "organizationId" = ${tenant.organizationId}::uuid AND status = 'ACTIVE'
          AND "expenseDate" >= ${fromDate}::date AND "expenseDate" <= ${toDate}::date
        GROUP BY 1
      )
      SELECT "periodStart", SUM(inflows) AS inflows, SUM(outflows) AS outflows,
        bool_or(mismatch) AS "currencyMismatch"
      FROM flows GROUP BY 1 ORDER BY 1
    `;
    return cashFlowResponse(rows, options, organization);
  }
}
