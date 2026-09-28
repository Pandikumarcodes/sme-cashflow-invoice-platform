import { IsIn, IsString } from 'class-validator';
import { ASSIGNABLE_MEMBERSHIP_ROLES } from '../domain/membership-policy.js';

export class ChangeMemberRoleDto {
  @IsString()
  @IsIn(ASSIGNABLE_MEMBERSHIP_ROLES)
  role;
}
