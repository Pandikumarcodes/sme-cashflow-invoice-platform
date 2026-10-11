import { IsString, Matches, MaxLength } from 'class-validator';
import { IsIdentityEmail } from '../domain/email.js';
import { IsAcceptablePassword } from '../domain/password-policy.js';

export class RegisterDto {
  @IsIdentityEmail()
  @MaxLength(320)
  email;

  @IsString()
  @IsAcceptablePassword()
  password;

  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'firstName must contain a non-whitespace character' })
  firstName;

  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'lastName must contain a non-whitespace character' })
  lastName;
}
