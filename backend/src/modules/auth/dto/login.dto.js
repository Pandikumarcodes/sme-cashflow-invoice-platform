import { IsString, MaxLength } from 'class-validator';
import { IsIdentityEmail } from '../domain/email.js';

export class LoginDto {
  @IsIdentityEmail()
  @MaxLength(320)
  email;

  @IsString()
  @MaxLength(512)
  password;
}
