export function toCustomerResponse(customer) {
  return {
    id: customer.id,
    organizationId: customer.organizationId,
    customerCode: customer.customerCode,
    displayName: customer.displayName,
    email: customer.email,
    status: customer.status,
    createdByUserId: customer.createdByUserId,
    version: customer.version,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
