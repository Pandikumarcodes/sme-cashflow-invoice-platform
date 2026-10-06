import { IsIn, IsString, Matches, ValidateIf } from 'class-validator';

export class CashFlowQueryDto {}
for (const field of ['fromDate', 'toDate']) {
  ValidateIf((_object, value) => value !== undefined)(CashFlowQueryDto.prototype, field);
  IsString()(CashFlowQueryDto.prototype, field);
  Matches(/^\d{4}-\d{2}-\d{2}$/)(CashFlowQueryDto.prototype, field);
}
ValidateIf((_object, value) => value !== undefined)(CashFlowQueryDto.prototype, 'groupBy');
IsIn(['day', 'week', 'month'])(CashFlowQueryDto.prototype, 'groupBy');
