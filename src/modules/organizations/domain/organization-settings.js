import { ValidateBy } from 'class-validator';

const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));

export function normalizeCurrency(value) {
  return value.trim().toUpperCase();
}

export function isSupportedCurrency(value) {
  return typeof value === 'string' && supportedCurrencies.has(normalizeCurrency(value));
}

export function isValidTimezone(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.Locale(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function normalizeInvoicePrefix(value) {
  return value.trim().toUpperCase();
}

export function normalizeSlug(value) {
  return value.trim().toLowerCase();
}

export function IsSupportedCurrency(validationOptions) {
  return ValidateBy(
    {
      name: 'isSupportedCurrency',
      validator: {
        validate: isSupportedCurrency,
        defaultMessage: () => 'baseCurrency must be a supported ISO 4217 currency code',
      },
    },
    validationOptions,
  );
}

export function IsIanaTimezone(validationOptions) {
  return ValidateBy(
    {
      name: 'isIanaTimezone',
      validator: {
        validate: isValidTimezone,
        defaultMessage: () => 'timezone must be a valid IANA timezone',
      },
    },
    validationOptions,
  );
}

export function IsBcp47Locale(validationOptions) {
  return ValidateBy(
    {
      name: 'isBcp47Locale',
      validator: {
        validate: isValidLocale,
        defaultMessage: () => 'locale must be a valid BCP 47 locale',
      },
    },
    validationOptions,
  );
}
