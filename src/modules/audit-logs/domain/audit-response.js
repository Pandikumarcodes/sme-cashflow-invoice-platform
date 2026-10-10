const fields = (names) => Object.fromEntries(names.split(' ').map((name) => [name, true]));
const settlement = fields('id invoiceNumber status paymentState amountPaid balanceDue version');
const payment = fields('id amount currency status updatedAt reversedAt reversalId');
const schemas = {
  Organization: fields(
    'legalName displayName slug baseCurrency timezone locale invoicePrefix invoiceNumberPadding defaultPaymentTermsDays status ownerMembershipId',
  ),
  Membership: fields('role status ownerMembershipId'),
  OrganizationInvitation: fields('email role status expiresAt membershipId'),
  Customer: fields('displayName customerCode email status version'),
  Invoice: {
    ...fields(
      'status invoiceNumber customerId total taxRate version cancelReason voidReason issueDate dueDate currency subtotal discountTotal taxableTotal taxTotal amountPaid balanceDue issuedAt',
    ),
    discount: fields('type value'),
    items: [fields('id quantity unitPrice lineAmount sortOrder')],
  },
  Payment: {
    ...payment,
    payment,
    invoice: settlement,
    reversal: fields('id paymentId amount reason reversalDate reversedByUserId createdAt'),
  },
  ExpenseCategory: fields('name normalizedName description status systemKey'),
  Expense: fields(
    'categoryId amount currency expenseDate vendorPayee description reference status version createdByUserId voidedByUserId voidedAt voidReason',
  ),
  ReportExport: fields('reportType format'),
};

// Fail closed for new/unknown structures. Persisted receipts and historical
// records remain untouched; only the public projection is sanitized.
function project(value, schema) {
  if (value === null || value === undefined) return null;
  if (schema === true) {
    if (typeof value === 'string') return value.length <= 2048 ? value : null;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      return value;
    return null;
  }
  if (Array.isArray(schema))
    return Array.isArray(value)
      ? value.slice(0, 100).map((item) => project(item, schema[0]))
      : null;
  if (!schema || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const [key, child] of Object.entries(schema)) {
    if (Object.hasOwn(value, key)) result[key] = project(value[key], child);
  }
  return Object.keys(result).length ? result : null;
}

function allowedPath(path, schema) {
  if (typeof path !== 'string' || !schema) return false;
  const [head, ...rest] = path.split('.');
  if (!Object.hasOwn(schema, head)) return false;
  return rest.length === 0 || allowedPath(rest.join('.'), schema[head]);
}

export function toAuditResponse(row) {
  const schema = Object.hasOwn(schemas, row.entityType) ? schemas[row.entityType] : undefined;
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorMembershipId: row.actorMembershipId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    outcome: row.outcome,
    source: row.source,
    occurredAt: row.occurredAt.toISOString(),
    requestId: row.requestId,
    correlationId: row.correlationId,
    changedFields: Array.isArray(row.changedFields)
      ? row.changedFields.filter((field) => allowedPath(field, schema)).slice(0, 100)
      : [],
    beforeData: project(row.beforeData, schema),
    afterData: project(row.afterData, schema),
    metadata: project(row.metadata, row.entityType === 'Organization' ? fields('reason') : null),
  };
}
