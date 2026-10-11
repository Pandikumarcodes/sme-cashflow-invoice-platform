import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CustomerListQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^(?:[1-9]\d?|100)$/)
  limit;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+$/)
  after;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  search;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(['displayName', 'createdAt', 'updatedAt'])
  sortBy;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder;
}
