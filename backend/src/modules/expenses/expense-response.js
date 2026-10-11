import { moneyString } from '../../common/money/decimal.js';

export function categoryResponse(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    systemKey: row.systemKey,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export function expenseResponse(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    categoryId: row.expenseCategoryId,
    category: {
      id: row.category.id,
      name: row.category.name,
      status: row.category.status,
      systemKey: row.category.systemKey,
    },
    vendorPayee: row.vendorPayee,
    amount: moneyString(row.amount, row.currency),
    currency: row.currency,
    expenseDate: row.expenseDate.toISOString().slice(0, 10),
    description: row.description,
    reference: row.reference,
    notes: row.notes,
    status: row.status,
    createdByUserId: row.createdByUserId,
    voidedByUserId: row.voidedByUserId,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
