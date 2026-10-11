import { IsIn, IsString, Matches, ValidateIf } from 'class-validator';

export class ProfitLossQueryDto {}
for (const field of ['fromDate', 'toDate']) {
  ValidateIf((_object, value) => value !== undefined)(ProfitLossQueryDto.prototype, field);
  IsString()(ProfitLossQueryDto.prototype, field);
  Matches(/^\d{4}-\d{2}-\d{2}$/)(ProfitLossQueryDto.prototype, field);
}
ValidateIf((_object, value) => value !== undefined)(ProfitLossQueryDto.prototype, 'groupBy');
IsIn(['none', 'month'])(ProfitLossQueryDto.prototype, 'groupBy');
