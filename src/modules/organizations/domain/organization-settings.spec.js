import {
  isSupportedCurrency,
  isValidLocale,
  isValidTimezone,
  normalizeCurrency,
  normalizeInvoicePrefix,
  normalizeSlug,
} from './organization-settings.js';
import { assertBaseCurrencyChangeAllowed } from './organization-policy.js';

describe('organization settings', () => {
  it('normalizes currency, invoice prefix, and slug values', () => {
    expect(normalizeCurrency(' inr ')).toBe('INR');
    expect(normalizeInvoicePrefix(' inv- ')).toBe('INV-');
    expect(normalizeSlug(' Acme-India ')).toBe('acme-india');
  });

  it('validates currencies using the runtime ISO 4217 registry', () => {
    expect(isSupportedCurrency('inr')).toBe(true);
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('ZZZ')).toBe(false);
    expect(isSupportedCurrency('12')).toBe(false);
  });

  it('validates IANA timezones and BCP 47 locales', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Not/A_Zone')).toBe(false);
    expect(isValidLocale('en-IN')).toBe(true);
    expect(isValidLocale('not_a_locale')).toBe(false);
  });

  it('allows currency change only before the organization is locked', () => {
    expect(
      assertBaseCurrencyChangeAllowed({ baseCurrency: 'INR', currencyLockedAt: null }, 'USD'),
    ).toBe(true);
    expect(
      assertBaseCurrencyChangeAllowed({ baseCurrency: 'INR', currencyLockedAt: new Date() }, 'USD'),
    ).toBe(false);
    expect(
      assertBaseCurrencyChangeAllowed({ baseCurrency: 'INR', currencyLockedAt: new Date() }, 'INR'),
    ).toBe(true);
  });
});
