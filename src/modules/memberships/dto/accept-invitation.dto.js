import { IsString, Matches } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token must be a valid invitation token' })
  token;
}
