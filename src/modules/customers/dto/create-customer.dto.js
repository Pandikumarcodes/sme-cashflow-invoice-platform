import { IsEmail, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @MaxLength(200)
  @Matches(/\S/, { message: 'displayName must contain a non-whitespace character' })
  displayName;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(50)
  @Matches(/\S/, { message: 'customerCode must contain a non-whitespace character' })
  customerCode;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email;
}
