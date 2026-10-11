import { IsString, Matches, ValidateIf } from 'class-validator';
export class AgingQueryDto {}
export class AnalyticsQueryDto extends AgingQueryDto {}
for (const [dto, fields] of [
  [AgingQueryDto, ['asOfDate']],
  [AnalyticsQueryDto, ['fromDate', 'toDate']],
]) {
  for (const field of fields) {
    ValidateIf((_o, value) => value !== undefined)(dto.prototype, field);
    IsString()(dto.prototype, field);
    Matches(/^\d{4}-\d{2}-\d{2}$/)(dto.prototype, field);
  }
}
