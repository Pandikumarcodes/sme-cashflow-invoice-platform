import { isEmail, ValidateBy } from 'class-validator';

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function IsIdentityEmail(validationOptions) {
  return ValidateBy(
    {
      name: 'isIdentityEmail',
      validator: {
        validate: (value) => typeof value === 'string' && isEmail(value.trim()),
        defaultMessage: () => 'email must be a valid email address',
      },
    },
    validationOptions,
  );
}
