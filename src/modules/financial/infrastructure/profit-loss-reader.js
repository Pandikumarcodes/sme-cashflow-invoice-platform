import { Inject, Injectable } from '@nestjs/common';
import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import { CashFlowReader } from './cash-flow-reader.js';
import { profitLossResponse } from '../domain/profit-loss.js';

@Injectable()
export class ProfitLossReader {
  constructor(cashFlow) {
    this.cashFlow = cashFlow;
  }
  async read(tx, tenant, options, organization) {
    requireTenantContext(tenant);
    const cash = await this.cashFlow.read(
      tx,
      tenant,
      { ...options, groupBy: 'month' },
      organization,
    );
    const categories = await tx.$queryRaw`
      SELECT c.id AS "categoryId", c.name AS "categoryName", SUM(e.amount) AS amount
      FROM expenses e
      JOIN expense_categories c ON c."organizationId" = e."organizationId"
        AND c.id = e."expenseCategoryId"
      WHERE e."organizationId" = ${tenant.organizationId}::uuid AND e.status = 'ACTIVE'
        AND e."expenseDate" >= ${options.fromDate}::date AND e."expenseDate" <= ${options.toDate}::date
      GROUP BY c.id, c.name ORDER BY c.name, c.id
    `;
    return profitLossResponse(cash, categories, options, organization);
  }
}
Inject(CashFlowReader)(ProfitLossReader, undefined, 0);
