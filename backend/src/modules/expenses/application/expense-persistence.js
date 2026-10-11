import { requireTenantContext } from '../../../common/tenancy/tenant-context.js';
import { moneyString } from '../../../common/money/decimal.js';
import {
  requireTenantResource,
  tenantResourceWhere,
} from '../../../database/helpers/tenant-query.js';

// Archive and new assignment hold the same category row lock through commit.
export async function findCategory(client, tenant, id, lock = false) {
  requireTenantContext(tenant);
  if (lock)
    await client.$queryRaw`SELECT "id" FROM "expense_categories" WHERE "organizationId" = ${tenant.organizationId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
  return requireTenantResource(
    await client.expenseCategory.findFirst({ where: tenantResourceWhere(tenant, id) }),
    'Expense category',
  );
}
export async function findExpense(client, tenant, id, lock = false) {
  requireTenantContext(tenant);
  if (lock)
    await client.$queryRaw`SELECT "id" FROM "expenses" WHERE "organizationId" = ${tenant.organizationId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
  return requireTenantResource(
    await client.expense.findFirst({
      where: tenantResourceWhere(tenant, id),
      include: { category: true },
    }),
    'Expense',
  );
}

export function expenseAudit(
  tx,
  tenant,
  entityType,
  action,
  id,
  beforeData,
  afterData,
  metadata,
  additionalChangedFields = [],
) {
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
      entityType,
      entityId: id,
      beforeData,
      afterData,
      changedFields: [
        ...Object.keys(afterData).filter(
          (field) => JSON.stringify(beforeData?.[field]) !== JSON.stringify(afterData[field]),
        ),
        ...additionalChangedFields,
      ],
      requestId: metadata.requestId,
      correlationId: metadata.correlationId,
    },
  });
}
export function categorySnapshot(row) {
  return {
    name: row.name,
    normalizedName: row.normalizedName,
    description: row.description,
    status: row.status,
    systemKey: row.systemKey,
  };
}
export function expenseSnapshot(row) {
  return {
    categoryId: row.expenseCategoryId,
    amount: moneyString(row.amount, row.currency),
    currency: row.currency,
    expenseDate: row.expenseDate.toISOString().slice(0, 10),
    vendorPayee: row.vendorPayee,
    description: row.description,
    reference: row.reference,
    status: row.status,
    version: row.version,
    createdByUserId: row.createdByUserId,
    voidedByUserId: row.voidedByUserId,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}
