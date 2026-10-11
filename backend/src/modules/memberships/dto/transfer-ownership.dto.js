import { IsUUID } from 'class-validator';

export class TransferOwnershipDto {
  @IsUUID('4')
  targetMembershipId;
}
