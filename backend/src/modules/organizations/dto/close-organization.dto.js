import { IsString, Matches, MaxLength } from 'class-validator';

export class CloseOrganizationDto {
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason must contain a non-whitespace character' })
  reason;
}
