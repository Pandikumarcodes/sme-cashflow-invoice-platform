import { IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'];

export class InvitationListQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(STATUSES)
  status;
}
