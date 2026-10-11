import { IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const VISIBLE_TEXT = /\S/;
const SLUG = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
const INVOICE_PREFIX = /^[A-Za-z0-9-]+$/;

export class CreateOrganizationDto {
  @IsString()
  @MaxLength(200)
  @Matches(VISIBLE_TEXT, { message: 'legalName must contain a non-whitespace character' })
  legalName;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  @Matches(VISIBLE_TEXT, { message: 'displayName must contain a non-whitespace character' })
  displayName;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  @Matches(SLUG, { message: 'slug must contain only letters, numbers, and single hyphens' })
  slug;

  @IsString()
  @Matches(/^\s*[A-Za-z]{3}\s*$/, { message: 'baseCurrency must be a 3-letter code' })
  baseCurrency;

  @IsString()
  @MaxLength(64)
  @Matches(/\S/, { message: 'timezone must contain a non-whitespace character' })
  timezone;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(35)
  @Matches(/\S/, { message: 'locale must contain a non-whitespace character' })
  locale;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(12)
  @Matches(INVOICE_PREFIX, {
    message: 'invoicePrefix must contain only letters, numbers, and hyphens',
  })
  invoicePrefix;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(12)
  invoiceNumberPadding;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(365)
  defaultPaymentTermsDays;
}
