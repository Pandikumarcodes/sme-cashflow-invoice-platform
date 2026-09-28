import { IsIn, IsOptional, IsString } from 'class-validator';

const ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'MEMBER', 'VIEWER'];
const STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'];

export class MemberListQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(ROLES)
  role;

  @IsOptional()
  @IsString()
  @IsIn(STATUSES)
  status;
}
