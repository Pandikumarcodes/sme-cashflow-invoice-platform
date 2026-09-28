import { ValidateBy, buildMessage } from 'class-validator';

export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_CHARACTERS = 128;
export const PASSWORD_MAX_BYTES = 512;

export function IsAcceptablePassword(validationOptions) {
  return ValidateBy(
    {
      name: 'isAcceptablePassword',
      validator: {
        validate: (value) =>
          typeof value === 'string' &&
          Array.from(value).length >= PASSWORD_MIN_CHARACTERS &&
          Array.from(value).length <= PASSWORD_MAX_CHARACTERS &&
          Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES,
        defaultMessage: buildMessage(
          () =>
            `password must be ${PASSWORD_MIN_CHARACTERS}-${PASSWORD_MAX_CHARACTERS} characters and at most ${PASSWORD_MAX_BYTES} UTF-8 bytes`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
