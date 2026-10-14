import { z } from 'zod';

const currencies = new Set(Intl.supportedValuesOf('currency'));
export const createOrganizationSchema = z.object({
  legalName: z
    .string()
    .max(200, 'Use at most 200 characters.')
    .refine((v) => /\S/.test(v), 'Enter the legal business name.'),
  displayName: z
    .string()
    .max(200, 'Use at most 200 characters.')
    .refine((v) => v === '' || /\S/.test(v), 'Enter a display name or leave it empty.'),
  baseCurrency: z
    .string()
    .refine(
      (v) => /^\s*[A-Za-z]{3}\s*$/.test(v) && currencies.has(v.trim().toUpperCase()),
      'Enter a supported three-letter currency code.',
    ),
  timezone: z
    .string()
    .max(64, 'Use at most 64 characters.')
    .refine((v) => {
      if (!v.trim()) return false;
      try {
        new Intl.DateTimeFormat('en', { timeZone: v.trim() }).format();
        return true;
      } catch {
        return false;
      }
    }, 'Enter a valid timezone, such as Asia/Kolkata or UTC.'),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export function organizationCreationBody(input: CreateOrganizationInput) {
  return {
    legalName: input.legalName.trim(),
    ...(input.displayName === '' ? {} : { displayName: input.displayName.trim() }),
    baseCurrency: input.baseCurrency.trim().toUpperCase(),
    timezone: input.timezone.trim(),
  };
}
