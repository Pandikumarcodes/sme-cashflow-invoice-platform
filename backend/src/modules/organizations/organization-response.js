export function toOrganizationResponse(organization, membership) {
  return {
    id: organization.id,
    legalName: organization.legalName,
    displayName: organization.displayName,
    slug: organization.slug,
    baseCurrency: organization.baseCurrency,
    timezone: organization.timezone,
    locale: organization.locale,
    invoicePrefix: organization.invoicePrefix,
    invoiceNumberPadding: organization.invoiceNumberPadding,
    defaultPaymentTermsDays: organization.defaultPaymentTermsDays,
    currencyLockedAt: organization.currencyLockedAt,
    status: organization.status,
    version: organization.version,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    membership: membership
      ? {
          id: membership.id,
          role: membership.role,
          status: membership.status,
          organizationTitle: membership.organizationTitle,
          joinedAt: membership.joinedAt,
        }
      : undefined,
  };
}

export function toOrganizationSummary(membership) {
  const organization = membership.organization;
  return {
    id: organization.id,
    legalName: organization.legalName,
    displayName: organization.displayName,
    status: organization.status,
    baseCurrency: organization.baseCurrency,
    timezone: organization.timezone,
    membership: {
      id: membership.id,
      role: membership.role,
      status: membership.status,
    },
    createdAt: organization.createdAt,
  };
}
