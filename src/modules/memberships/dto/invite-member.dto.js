import { IsIn, IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';
import { IsIdentityEmail } from '../../auth/domain/email.js';
import { ASSIGNABLE_MEMBERSHIP_ROLES } from '../domain/membership-policy.js';

export class InviteMemberDto {
  @IsIdentityEmail()
  email;

  @IsString()
  @IsIn(ASSIGNABLE_MEMBERSHIP_ROLES)
  role;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays;
}
