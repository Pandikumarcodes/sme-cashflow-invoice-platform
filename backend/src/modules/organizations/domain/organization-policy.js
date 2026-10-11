export function assertBaseCurrencyChangeAllowed(organization, nextCurrency) {
  if (
    nextCurrency !== undefined &&
    nextCurrency !== organization.baseCurrency &&
    organization.currencyLockedAt
  ) {
    return false;
  }
  return true;
}
